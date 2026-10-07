import { resolve } from "node:path";
import { z } from "zod";
import { getWebDatabase } from "@/server/db/client";
import { toPublicEnvironmentIdentity } from "@/server/environment/contract";
import {
  readActiveSnapshot,
  readSyncWorkspace,
  syncRoot,
} from "@/config/data-sync-state";
import { readJson } from "@/development/runtime";
import { readDataLock } from "./git";
import { tables, tableDefinition, quote, orderByKeys } from "./schema";

export interface DatabaseOverview {
  workspace: { id: string; name: string; profile: string } | null;
  environment: ReturnType<typeof toPublicEnvironmentIdentity>;
  target: Awaited<ReturnType<typeof readDataLock>>;
  activeSnapshot: string | null;
  lastVerification: {
    state: string;
    checkedAt: string;
    databaseDigest: string | null;
    problems: string[];
  } | null;
  tables: {
    name: string;
    rows: number;
    bytes: number;
    columns: {
      name: string;
      type: string;
      primary: boolean;
      nullable: boolean;
    }[];
  }[];
  heads: Record<string, Record<string, unknown>[]>;
}
export async function databaseOverview(): Promise<DatabaseOverview> {
  const db = await getWebDatabase();
  const identity = await db.verifyIdentity();
  const workspace = readSyncWorkspace();
  const active = readActiveSnapshot();
  const raw = await readJson<unknown>(resolve(syncRoot(), "verification.json"));
  const report = z
    .object({
      state: z.string(),
      checkedAt: z.iso.datetime(),
      problems: z.array(z.string()),
      current: z
        .object({
          databaseDigest: z.string(),
          identity: z.object({ databaseId: z.string() }),
        })
        .nullable(),
    })
    .safeParse(raw);
  const counts = await db.readSnapshot(async (reader) => {
    const rows = await reader.query<{
      name: string;
      rows: string;
      bytes: string;
    }>(
      tables
        .map(
          (table) =>
            `SELECT '${table.name}'::text AS name,count(*)::text AS rows,pg_total_relation_size('public.${table.name}'::regclass)::text AS bytes FROM public.${quote(table.name)}`,
        )
        .join(" UNION ALL "),
    );
    const heads: DatabaseOverview["heads"] = {};
    for (const table of [
      "dataset_heads",
      "asset_dataset_heads",
      "unit_asset_heads",
      "item_asset_heads",
    ])
      heads[table] = (
        await reader.query(`SELECT * FROM public.${quote(table)}`)
      ).rows;
    return { rows: rows.rows, heads };
  });
  return {
    workspace: workspace
      ? {
          id: workspace.id,
          name: workspace.environmentName,
          profile: workspace.profile,
        }
      : null,
    environment: toPublicEnvironmentIdentity(identity),
    target: await readDataLock(),
    activeSnapshot: active?.snapshotId ?? null,
    lastVerification:
      report.success &&
      report.data.current?.identity.databaseId === identity.databaseId
        ? {
            state: report.data.state,
            checkedAt: report.data.checkedAt,
            databaseDigest: report.data.current.databaseDigest,
            problems: report.data.problems,
          }
        : null,
    tables: tables.map((table) => ({
      name: table.name,
      rows: Number(
        counts.rows.find((row) => row.name === table.name)?.rows ?? 0,
      ),
      bytes: Number(
        counts.rows.find((row) => row.name === table.name)?.bytes ?? 0,
      ),
      columns: table.columns.map((column) => ({
        name: column.name,
        type: column.type,
        primary: table.keys.includes(column.name),
        nullable: column.nullable === "YES",
      })),
    })),
    heads: counts.heads,
  };
}
export interface DatabasePage {
  table: string;
  offset: number;
  limit: number;
  hasMore: boolean;
  rows: Record<string, string | null>[];
}
export async function databaseRecords(
  params: URLSearchParams,
): Promise<DatabasePage> {
  const name = params.get("table") ?? "";
  const table = tableDefinition(name);
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .parse(params.get("offset") ?? 0);
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .parse(params.get("limit") ?? 50);
  const column = params.get("column") ?? "";
  const query = z
    .string()
    .max(200)
    .parse(params.get("q") ?? "");
  if (
    column &&
    !table.columns.some((item) => item.name === column && item.type !== "bytea")
  )
    throw new Error("Invalid filter column.");
  if (query && !column) throw new Error("Select a filter column.");
  const sqlColumns = table.columns
    .map((item) =>
      item.type === "bytea"
        ? `('[binary ' || octet_length(${quote(item.name)}) || ' bytes]') AS ${quote(item.name)}`
        : `CASE WHEN length(${quote(item.name)}::text)>12000 THEN left(${quote(item.name)}::text,12000)||' … [truncated]' ELSE ${quote(item.name)}::text END AS ${quote(item.name)}`,
    )
    .join(",");
  const values: unknown[] = [limit + 1, offset];
  let where = "";
  if (query) {
    values.push(query);
    where = `WHERE strpos(lower(${quote(column)}::text),lower($3))>0`;
  }
  const db = await getWebDatabase();
  const result = await db.readSnapshot((reader) =>
    reader.query<Record<string, string | null>>(
      `SELECT ${sqlColumns} FROM public.${quote(name)} ${where} ORDER BY ${orderByKeys(table)} LIMIT $1 OFFSET $2`,
      values,
    ),
  );
  return {
    table: name,
    offset,
    limit,
    hasMore: result.rows.length > limit,
    rows: result.rows.slice(0, limit),
  };
}
export async function databaseImage(hash: string): Promise<Response> {
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(hash);
  const db = await getWebDatabase();
  const result = await db.query<{ content: Buffer; mime_type: string }>(
    "SELECT content,mime_type FROM public.asset_blobs WHERE content_sha256=$1",
    [hash],
  );
  const row = result.rows[0];
  if (!row) return new Response(null, { status: 404 });
  if (!["image/png", "image/jpeg", "image/webp"].includes(row.mime_type))
    return new Response(null, { status: 415 });
  return new Response(new Uint8Array(row.content), {
    headers: {
      "Content-Type": row.mime_type,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
