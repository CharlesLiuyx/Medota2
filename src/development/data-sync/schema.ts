import expected from "./schema.v1.json";
import { digest, type TextRow } from "./protocol";
import type { VerifiedReadSnapshot } from "@/server/environment/contract";

export const EXCLUDED_TABLES = [
  "schema_migrations",
  "catalog_import_staging",
  "hero_import_staging",
];
export const schemaDigest = digest(expected);
export type ReviewedSchema = typeof expected;
export function schemaTables(schema: ReviewedSchema) {
  return schema.columns
    .map((table) => ({
      name: table.table_name,
      columns: table.columns,
      keys: schema.keys.find((key) => key.table_name === table.table_name)!
        .columns,
    }))
    .filter((table) => !EXCLUDED_TABLES.includes(table.name));
}
export const definitions = expected.columns.map((table) => ({
  name: table.table_name,
  columns: table.columns,
  keys: expected.keys.find((key) => key.table_name === table.table_name)!
    .columns,
}));
export const tables = definitions.filter(
  (table) => !EXCLUDED_TABLES.includes(table.name),
);
export type TableDefinition = (typeof definitions)[number];
export const quote = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name))
    throw new Error("Invalid SQL identifier.");
  return `"${name}"`;
};
export function tableDefinition(name: string): TableDefinition {
  const result = tables.find((table) => table.name === name);
  if (!result) throw new Error("Unknown or excluded table.");
  return result;
}
export const cyclicResults = [
  "result_catalog_version_id",
  "result_reference_snapshot_id",
  "result_comparison_id",
];

export function restoreOrder(): TableDefinition[] {
  const pending = new Map(tables.map((table) => [table.name, table]));
  const sorted: TableDefinition[] = [];
  while (pending.size) {
    const next = [...pending.values()].find((table) => {
      const fks = expected.constraints.filter(
        (c) => c.table_name === table.name && c.type === "f",
      );
      return fks.every((fk) => {
        if (
          table.name === "import_runs" &&
          cyclicResults.some((key) =>
            fk.definition.startsWith(`FOREIGN KEY (${key})`),
          )
        )
          return true;
        const parent = /REFERENCES ([a-z_]+)\(/.exec(fk.definition)?.[1];
        if (!parent)
          throw new Error("Unrecognized foreign key in reviewed schema.");
        return !pending.has(parent);
      });
    });
    if (!next) throw new Error("Unsupported cycle in reviewed restore schema.");
    sorted.push(next);
    pending.delete(next.name);
  }
  return sorted;
}

export async function assertReviewedSchema(
  reader: VerifiedReadSnapshot,
  schema: ReviewedSchema = expected,
): Promise<void> {
  const columns = (
    await reader.query(
      "SELECT c.relname AS table_name, json_agg(json_build_object('name',a.attname,'type',t.typname,'nullable',CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END,'identity',CASE WHEN a.attidentity<>'' THEN 'YES' ELSE 'NO' END) ORDER BY a.attnum) AS columns FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped GROUP BY c.relname ORDER BY c.relname",
    )
  ).rows;
  const constraints = (
    await reader.query(
      "SELECT conrelid::regclass::text AS table_name, conname AS name, contype AS type, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace ORDER BY 1,2",
    )
  ).rows;
  const keys = (
    await reader.query(
      "SELECT c.relname AS table_name, array_agg(a.attname::text ORDER BY k.ordinality) AS columns FROM pg_class c JOIN pg_index i ON i.indrelid=c.oid AND i.indisprimary JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) ON true JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=k.attnum WHERE c.relnamespace='public'::regnamespace GROUP BY c.relname ORDER BY c.relname",
    )
  ).rows;
  if (digest({ columns, constraints, keys }) !== digest(schema))
    throw new Error(
      "Database schema differs from the reviewed snapshot schema. Review new tables, columns or constraints before exporting/restoring.",
    );
}

export function selectTextColumns(table: TableDefinition): string {
  return table.columns
    .map((column) =>
      column.type === "bytea"
        ? `encode(${quote(column.name)}, 'hex') AS ${quote(column.name)}`
        : `${quote(column.name)}::text AS ${quote(column.name)}`,
    )
    .join(", ");
}
export function orderByKeys(table: TableDefinition): string {
  return table.keys.map((key) => `${quote(key)}::text COLLATE "C"`).join(", ");
}
export function assertTextRow(
  table: TableDefinition,
  value: unknown,
): asserts value is TextRow {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid row in ${table.name}.`);
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join() !==
    table.columns
      .map((column) => column.name)
      .sort()
      .join()
  )
    throw new Error(`Unexpected columns in ${table.name}.`);
  for (const column of table.columns) {
    const cell = row[column.name];
    if (!(
      typeof cell === "string" ||
      (cell === null && column.nullable === "YES")
    ))
      throw new Error(`Invalid value in ${table.name}.${column.name}.`);
  }
}
