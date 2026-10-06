import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  VerifiedDatabase,
  VerifiedReadSnapshot,
} from "@/server/environment/contract";
import { listMigrations } from "@/server/db/migrations";
import {
  tables,
  assertReviewedSchema,
  quote,
  selectTextColumns,
  orderByKeys,
  assertTextRow,
  restoreOrder,
  cyclicResults,
} from "./schema";
import {
  canonical,
  digest,
  sha256,
  assertPublishableText,
  type SnapshotManifest,
  type TextRow,
  type FileIdentity,
} from "./protocol";
import { blobPath, chunkPath, putBlob, putFile, verifiedFile } from "./files";

export async function migrationDigest(): Promise<string> {
  return digest(
    (await listMigrations()).map(({ id, sha256 }) => ({ id, sha256 })),
  );
}
export async function assertMigrations(
  reader: VerifiedReadSnapshot,
): Promise<void> {
  const expected = (await listMigrations()).map(({ id, sha256 }) => ({
    id,
    sha256,
  }));
  const actual = (
    await reader.query(
      "SELECT migration_id AS id,file_sha256 AS sha256 FROM public.schema_migrations ORDER BY migration_id",
    )
  ).rows;
  if (digest(expected) !== digest(actual))
    throw new Error("Migration ledger does not match the current code.");
}

export async function collectDatabase(
  reader: VerifiedReadSnapshot,
  root?: string,
): Promise<{
  tables: SnapshotManifest["tables"];
  objects: FileIdentity[];
  heads: SnapshotManifest["heads"];
  sourceRows: TextRow[];
  sourceFileRows: TextRow[];
}> {
  await assertReviewedSchema(reader);
  await assertMigrations(reader);
  const unfinished = await reader.query(
    "SELECT count(*)::int AS n FROM public.import_runs WHERE status NOT IN ('succeeded','failed')",
  );
  if (unfinished.rows[0].n !== 0)
    throw new Error(
      "Finish active imports before exporting or applying a snapshot.",
    );
  const result: Awaited<ReturnType<typeof collectDatabase>> = {
    tables: [],
    objects: [],
    heads: {},
    sourceRows: [],
    sourceFileRows: [],
  };
  const objects = new Map<string, FileIdentity>();
  for (const table of tables) {
    const inspectAssets = table.name === "asset_blobs" && !root;
    const chunks: FileIdentity[] = [];
    let total = 0,
      lines: string[] = [],
      byteCount = 0;
    async function flush() {
      if (!lines.length) return;
      const bytes = Buffer.from(lines.join(""));
      const file = { sha256: sha256(bytes), bytes: bytes.length };
      if (root) await putFile(chunkPath(root, file.sha256), bytes);
      chunks.push(file);
      lines = [];
      byteCount = 0;
    }
    for (;;) {
      const page = await reader.query<TextRow>(
        `SELECT ${
          inspectAssets
            ? table.columns
                .map((column) =>
                  column.name === "content"
                    ? `encode(sha256(content), 'hex') AS content`
                    : `${quote(column.name)}::text AS ${quote(column.name)}`,
                )
                .join(", ") +
              ", octet_length(content)::text AS actual_byte_size"
            : selectTextColumns(table)
        } FROM public.${quote(table.name)} ORDER BY ${orderByKeys(table)} LIMIT 250 OFFSET $1`,
        [total],
      );
      if (!page.rows.length) break;
      for (const row of page.rows) {
        const actualBytes = row.actual_byte_size;
        if (inspectAssets) delete row.actual_byte_size;
        assertTextRow(table, row);
        if (table.name === "asset_blobs") {
          // Inspection hashes the actual bytea on the server instead of moving hex payloads.
          // Export still reads every byte. Both paths compare the declared hash and size.
          const blob = inspectAssets ? null : Buffer.from(row.content!, "hex");
          const file = {
            sha256: inspectAssets ? row.content! : sha256(blob!),
            bytes: inspectAssets ? Number(actualBytes) : blob!.length,
          };
          if (
            file.sha256 !== row.content_sha256 ||
            String(file.bytes) !== row.byte_size
          )
            throw new Error("Database asset checksum mismatch.");
          if (root) await putBlob(root, blob!);
          objects.set(file.sha256, file);
          row.content = `sha256:${file.sha256}`;
        }
        const line = canonical(row) + "\n";
        assertPublishableText(line, table.name);
        if (byteCount + Buffer.byteLength(line) > 1024 * 1024) await flush();
        lines.push(line);
        byteCount += Buffer.byteLength(line);
        total++;
        if (
          ["dataset_heads", "asset_dataset_heads", "unit_asset_heads"].includes(
            table.name,
          )
        )
          (result.heads[table.name] ??= []).push(row);
        if (table.name === "source_snapshots") result.sourceRows.push(row);
        if (table.name === "source_snapshot_files")
          result.sourceFileRows.push(row);
      }
    }
    await flush();
    result.tables.push({ name: table.name, rows: total, chunks });
  }
  result.objects = [...objects.values()].sort((a, b) =>
    a.sha256.localeCompare(b.sha256),
  );
  return result;
}

/** All inserts go into a verified, empty candidate; no DELETE, DDL or disabled constraints. */
export async function restoreDatabase(
  database: VerifiedDatabase<"restore">,
  manifest: SnapshotManifest,
  root: string,
): Promise<void> {
  const session = await database.connect();
  try {
    await session.query("BEGIN");
    await session.query(
      "SELECT set_config('TimeZone','UTC',true), set_config('DateStyle','ISO, YMD',true)",
    );
    await assertReviewedSchema(session);
    await assertMigrations(session);
    for (const table of tables) {
      if (
        (
          await session.query(
            `SELECT 1 FROM public.${quote(table.name)} LIMIT 1`,
          )
        ).rowCount
      )
        throw new Error(
          "Restore destination must have no existing business data.",
        );
    }
    const delayed: TextRow[] = [];
    const objects = new Map(
      manifest.objects.map((object) => [object.sha256, object]),
    );
    for (const table of restoreOrder()) {
      const saved = manifest.tables.find((entry) => entry.name === table.name)!;
      let count = 0;
      const columns = table.columns.map((c) => quote(c.name)).join(",");
      let batch: unknown[][] = [];
      let batchBytes = 0;
      const rowLimit = Math.min(500, Math.floor(60_000 / table.columns.length));
      async function flush() {
        if (!batch.length) return;
        const placeholders = batch
          .map(
            (_, row) =>
              `(${table.columns.map((c, column) => `$${row * table.columns.length + column + 1}::pg_catalog.${quote(c.type)}`).join(",")})`,
          )
          .join(",");
        await session.query(
          `INSERT INTO public.${quote(table.name)} (${columns}) OVERRIDING SYSTEM VALUE VALUES ${placeholders}`,
          batch.flat(),
        );
        batch = [];
        batchBytes = 0;
      }
      for (const chunk of saved.chunks) {
        const text = (
          await verifiedFile(chunkPath(root, chunk.sha256), chunk)
        ).toString("utf8");
        for (const line of text.trimEnd().split("\n")) {
          const row: unknown = JSON.parse(line);
          assertTextRow(table, row);
          if (table.name === "import_runs") delayed.push({ ...row });
          const values: unknown[] = [];
          for (const column of table.columns) {
            let value: string | Buffer | null = row[column.name];
            if (
              table.name === "import_runs" &&
              cyclicResults.includes(column.name)
            )
              value = null;
            if (column.type === "bytea") {
              const hash = String(value).replace(/^sha256:/, "");
              const file = objects.get(hash);
              if (!file || value !== `sha256:${hash}`)
                throw new Error("Missing asset blob in manifest.");
              value = await verifiedFile(blobPath(root, hash), file);
            }
            values.push(value);
          }
          const size = values.reduce<number>(
            (sum, value) =>
              sum +
              (Buffer.isBuffer(value)
                ? value.length
                : typeof value === "string"
                  ? Buffer.byteLength(value)
                  : 0),
            0,
          );
          if (
            batch.length &&
            (batch.length >= rowLimit || batchBytes + size > 2 * 1024 * 1024)
          )
            await flush();
          batch.push(values);
          batchBytes += size;
          count++;
        }
      }
      await flush();
      if (count !== saved.rows)
        throw new Error(`Row count mismatch in ${table.name}.`);
    }
    for (const row of delayed)
      await session.query(
        "UPDATE public.import_runs SET result_catalog_version_id=$2,result_reference_snapshot_id=$3,result_comparison_id=$4 WHERE id=$1",
        [row.id, ...cyclicResults.map((key) => row[key])],
      );
    for (const table of tables)
      for (const column of table.columns.filter((c) => c.identity === "YES")) {
        await session.query(
          `SELECT setval(pg_get_serial_sequence($1,$2), COALESCE(max(${quote(column.name)}),1), count(*) > 0) FROM public.${quote(table.name)}`,
          [`public.${table.name}`, column.name],
        );
      }
    await session.query("COMMIT");
  } catch (error) {
    await session.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    session.release();
  }
}

export async function readDataLockFile(
  path = resolve("dev-data.lock.json"),
): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
