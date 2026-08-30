import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLocalEnv } from "@/config/env";
import { HERO_IMPORT_LOCK_KEYS } from "@/importers/dota-vpk/constants";
import {
  assertSchemaCurrent,
  currentTargetSchemaVersion,
} from "@/server/db/migrations";
import { runMigrations } from "@/server/db/run-migrations";

const { Pool } = pg;
loadLocalEnv();

const migrationUrl = requiredTestUrl("DATABASE_URL_MIGRATION_TEST");
const workerUrl = requiredTestUrl("DATABASE_URL_WORKER_TEST");
const webUrl = requiredTestUrl("DATABASE_URL_WEB_TEST");
const owner = new Pool({ connectionString: migrationUrl, max: 1 });
const worker = new Pool({ connectionString: workerUrl, max: 1 });
const web = new Pool({ connectionString: webUrl, max: 1 });

describe("PostgreSQL MVP contract", () => {
  beforeAll(async () => {
    await runMigrations(migrationUrl);
    expect(
      (await owner.query<{ name: string }>("SELECT current_database() AS name"))
        .rows[0].name,
    ).toMatch(/_test$/u);
  });

  afterAll(async () => {
    await Promise.all([owner.end(), worker.end(), web.end()]);
  });

  it("applies the checked migration ledger to a real PostgreSQL database", async () => {
    await expect(assertSchemaCurrent(worker)).resolves.toBe(
      await currentTargetSchemaVersion(),
    );
    const tables = await owner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('heroes', 'dataset_heads', 'hero_reference_diffs')`,
    );
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      "dataset_heads",
      "hero_reference_diffs",
      "heroes",
    ]);
  });

  it("keeps Web read-only and prevents Worker DDL or direct head updates", async () => {
    await expect(
      web.query("SELECT count(*) FROM heroes"),
    ).resolves.toBeDefined();
    await expect(
      web.query(
        `INSERT INTO import_runs
          (source_kind, status, stage, medota2_commit, transformer_version, target_schema_version)
         VALUES ('vpk', 'running', 'test', $1, 'test', 'test')`,
        ["0".repeat(40)],
      ),
    ).rejects.toThrow(/permission denied/u);
    await expect(
      worker.query("CREATE TABLE forbidden_worker_ddl (id int)"),
    ).rejects.toThrow(/permission denied/u);
    await expect(
      worker.query(
        "UPDATE dataset_heads SET updated_at = now() WHERE dataset_key = 'heroes'",
      ),
    ).rejects.toThrow(/permission denied/u);
  });

  it("requires the advisory lock and promotes a validated immutable version atomically", async () => {
    const client = await worker.connect();
    try {
      await client.query("BEGIN");
      const snapshot = await client.query<{ id: string }>(
        `INSERT INTO source_snapshots
          (source_repository, source_remote_url, source_commit, manifest_sha256, source_dirty,
           source_inputs_match_head, client_version, source_revision)
         VALUES ('integration-fixture', 'https://example.invalid/fixture', $1, $2, false, true, 'fixture', 'fixture')
         RETURNING id`,
        ["1".repeat(40), "2".repeat(64)],
      );
      const run = await client.query<{ id: string }>(
        `INSERT INTO import_runs
          (source_kind, status, stage, medota2_commit, transformer_version, target_schema_version)
         VALUES ('vpk', 'running', 'integration-test', $1, 'hero-vpk-v1/test', $2)
         RETURNING id`,
        ["3".repeat(40), await currentTargetSchemaVersion()],
      );
      const version = await client.query<{ id: string }>(
        `INSERT INTO hero_dataset_versions
          (source_snapshot_id, import_run_id, importer_version, target_schema_version, status)
         VALUES ($1, $2, 'hero-vpk-v1/test', $3, 'validated') RETURNING id`,
        [
          snapshot.rows[0].id,
          run.rows[0].id,
          await currentTargetSchemaVersion(),
        ],
      );

      await client.query("SAVEPOINT missing_lock");
      await expect(
        client.query("SELECT promote_hero_dataset_version($1)", [
          version.rows[0].id,
        ]),
      ).rejects.toThrow(/advisory lock is required/u);
      await client.query("ROLLBACK TO SAVEPOINT missing_lock");

      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ...HERO_IMPORT_LOCK_KEYS,
      ]);
      await client.query("SELECT promote_hero_dataset_version($1)", [
        version.rows[0].id,
      ]);
      const head = await client.query<{ hero_dataset_version_id: string }>(
        "SELECT hero_dataset_version_id FROM dataset_heads WHERE dataset_key = 'heroes'",
      );
      expect(head.rows[0].hero_dataset_version_id).toBe(version.rows[0].id);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("enforces canonical check constraints", async () => {
    const result = await owner.query<{ constraints: number }>(
      `SELECT count(*)::int AS constraints
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'heroes' AND c.contype = 'c'`,
    );
    expect(result.rows[0].constraints).toBeGreaterThanOrEqual(7);
  });
});

function requiredTestUrl(key: string): string {
  const value = process.env[key];
  if (!value || !value.includes("_test"))
    throw new Error(`${key} must point to an explicitly named test database.`);
  return value;
}
