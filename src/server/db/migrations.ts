import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  VerifiedDatabase,
  VerifiedSession,
} from "@/server/environment/contract";

export interface MigrationIdentity {
  id: string;
  path: string;
  sha256: string;
}

export async function listMigrations(
  root = process.cwd(),
): Promise<MigrationIdentity[]> {
  const directory = resolve(root, "drizzle");
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0)
    throw new Error("No SQL migrations found in drizzle/.");

  return Promise.all(
    files.map(async (id) => {
      const path = resolve(directory, id);
      const bytes = await readFile(path);
      return {
        id,
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      };
    }),
  );
}

export async function currentTargetSchemaVersion(
  root = process.cwd(),
): Promise<string> {
  const migrations = await listMigrations(root);
  const latest = migrations.at(-1)!;
  return `${latest.id}:${latest.sha256}`;
}

export async function ensureMigrationLedger(
  client: VerifiedSession,
): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      migration_id text PRIMARY KEY,
      file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function assertSchemaCurrent(
  database: VerifiedDatabase,
  root = process.cwd(),
): Promise<string> {
  const migrations = await listMigrations(root);
  const result = await database.query<{
    migration_id: string;
    file_sha256: string;
  }>(
    "SELECT migration_id, file_sha256 FROM schema_migrations ORDER BY migration_id",
  );
  const applied = new Map(
    result.rows.map((row) => [row.migration_id, row.file_sha256]),
  );

  for (const migration of migrations) {
    const checksum = applied.get(migration.id);
    if (!checksum)
      throw new Error(
        `Database migration ${migration.id} has not been applied.`,
      );
    if (checksum !== migration.sha256) {
      throw new Error(
        `Database migration ${migration.id} checksum does not match the repository.`,
      );
    }
  }

  const latest = migrations.at(-1)!;
  return `${latest.id}:${latest.sha256}`;
}
