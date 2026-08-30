import { readFile } from "node:fs/promises";
import pg from "pg";
import { ensureMigrationLedger, listMigrations } from "./migrations";

const { Pool } = pg;

export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await ensureMigrationLedger(client);
    const migrations = await listMigrations();
    for (const migration of migrations) {
      const existing = await client.query<{ file_sha256: string }>(
        "SELECT file_sha256 FROM schema_migrations WHERE migration_id = $1",
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
          "INSERT INTO schema_migrations (migration_id, file_sha256) VALUES ($1, $2)",
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
    await pool.end();
  }
}
