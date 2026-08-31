import { readFile } from "node:fs/promises";
import type { VerifiedDatabase } from "@/server/environment/contract";
import { ensureMigrationLedger, listMigrations } from "./migrations";

export async function runMigrations(
  database: VerifiedDatabase<"migrate">,
): Promise<string[]> {
  const client = await database.connect();
  const applied: string[] = [];
  try {
    // Attestation deliberately resolves built-ins from pg_catalog first. The
    // checked historical migrations contain unqualified application objects,
    // so only this already-verified migration session selects public as the
    // DDL target. PUBLIC cannot CREATE there and the migrator owns the database.
    await client.query("SET search_path TO public, pg_catalog");
    await ensureMigrationLedger(client);
    const migrations = await listMigrations();
    for (const migration of migrations) {
      const existing = await client.query<{ file_sha256: string }>(
        "SELECT file_sha256 FROM public.schema_migrations WHERE migration_id = $1",
        [migration.id],
      );
      if (existing.rowCount) {
        if (existing.rows[0].file_sha256 !== migration.sha256) {
          throw new Error(
            `Applied migration ${migration.id} has a different checksum.`,
          );
        }
        continue;
      }
      const sql = await readFile(migration.path, "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO public.schema_migrations (migration_id, file_sha256) VALUES ($1, $2)",
          [migration.id, migration.sha256],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      applied.push(migration.id);
    }
    return applied;
  } finally {
    client.release();
  }
}
