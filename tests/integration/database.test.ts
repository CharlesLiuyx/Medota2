import type { PoolClient } from "pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLocalEnv } from "@/config/env";
import { CATALOG_IMPORT_LOCK_KEYS } from "@/importers/dota-vpk/constants";
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
const competingWorker = new Pool({ connectionString: workerUrl, max: 1 });
const web = new Pool({ connectionString: webUrl, max: 1 });
let identity = 0;

describe("PostgreSQL Hero Catalog v2 contract", () => {
  beforeAll(async () => {
    await runMigrations(migrationUrl);
    expect(
      (await owner.query<{ name: string }>("SELECT current_database() AS name"))
        .rows[0].name,
    ).toMatch(/_test$/u);
    await owner.query(
      "TRUNCATE source_snapshots, import_runs, reference_snapshots CASCADE",
    );
  });

  afterAll(async () => {
    await Promise.all([
      owner.end(),
      worker.end(),
      competingWorker.end(),
      web.end(),
    ]);
  });

  it("applies the checked migration ledger and creates the shared catalog schema", async () => {
    await expect(assertSchemaCurrent(worker)).resolves.toBe(
      await currentTargetSchemaVersion(),
    );
    const tables = await owner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN
         ('heroes', 'abilities', 'hero_ability_bindings', 'hero_catalog_dataset_versions',
          'catalog_semantic_diffs', 'catalog_reviews', 'catalog_rollbacks')`,
    );
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      "abilities",
      "catalog_reviews",
      "catalog_rollbacks",
      "catalog_semantic_diffs",
      "hero_ability_bindings",
      "hero_catalog_dataset_versions",
      "heroes",
    ]);
  });

  it("keeps Web read-only and prevents Worker DDL or direct head updates", async () => {
    await expect(
      web.query("SELECT count(*) FROM abilities"),
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
        "UPDATE dataset_heads SET updated_at = now() WHERE dataset_key = 'hero_catalog'",
      ),
    ).rejects.toThrow(/permission denied/u);
  });

  it("auto-promotes Green, holds Yellow for Review, then promotes it", async () => {
    const client = await worker.connect();
    try {
      await client.query("BEGIN");
      const green = await insertVersion(client, "green");
      await expect(
        client.query("SELECT promote_hero_catalog_version($1)", [green]),
      ).rejects.toThrow(/advisory lock is required/u);
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ...CATALOG_IMPORT_LOCK_KEYS,
      ]);
      const promotedGreen = await insertVersion(client, "green");
      await client.query("SELECT promote_hero_catalog_version($1)", [
        promotedGreen,
      ]);
      const yellow = await insertVersion(client, "yellow");
      await client.query("SAVEPOINT yellow_gate");
      await expect(
        client.query("SELECT promote_hero_catalog_version($1)", [yellow]),
      ).rejects.toThrow(/has not passed/u);
      await client.query("ROLLBACK TO SAVEPOINT yellow_gate");
      await client.query(
        "SELECT review_hero_catalog_version($1, 'approved', 'integration review')",
        [yellow],
      );
      await client.query("SELECT promote_hero_catalog_version($1)", [yellow]);
      const red = await insertVersion(client, "red");
      await client.query("SAVEPOINT red_gate");
      await expect(
        client.query("SELECT promote_hero_catalog_version($1)", [red]),
      ).rejects.toThrow(/has not passed/u);
      await client.query("ROLLBACK TO SAVEPOINT red_gate");
      const head = await client.query<{ id: string }>(
        "SELECT catalog_dataset_version_id AS id FROM dataset_heads WHERE dataset_key = 'hero_catalog'",
      );
      expect(head.rows[0].id).toBe(yellow);
      const review = await client.query<{ reviewer: string }>(
        "SELECT reviewer FROM catalog_reviews WHERE candidate_version_id = $1",
        [yellow],
      );
      expect(review.rows[0].reviewer).toBe("medota2_worker");
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  });

  it("allows only one refresh lock owner at a time", async () => {
    const active = await worker.connect();
    const contender = await competingWorker.connect();
    try {
      await active.query("BEGIN");
      await contender.query("BEGIN");
      await active.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ...CATALOG_IMPORT_LOCK_KEYS,
      ]);
      const result = await contender.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_xact_lock($1, $2) AS acquired",
        [...CATALOG_IMPORT_LOCK_KEYS],
      );
      expect(result.rows[0].acquired).toBe(false);
      await active.query("ROLLBACK");
      await contender.query("ROLLBACK");
    } finally {
      active.release();
      contender.release();
    }
  });

  it("does not retain a partially materialized candidate after transaction failure", async () => {
    const before = await owner.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM hero_catalog_dataset_versions",
    );
    const client = await worker.connect();
    try {
      await client.query("BEGIN");
      await insertVersion(client, "green");
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    const after = await owner.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM hero_catalog_dataset_versions",
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("atomically rolls back to a retained validated version and audits the actor", async () => {
    const client = await worker.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ...CATALOG_IMPORT_LOCK_KEYS,
      ]);
      const first = await insertVersion(client, "green");
      await client.query("SELECT promote_hero_catalog_version($1)", [first]);
      const second = await insertVersion(client, "green");
      await client.query("SELECT promote_hero_catalog_version($1)", [second]);
      await client.query(
        "SELECT rollback_hero_catalog_version($1, 'integration rollback')",
        [first],
      );
      const head = await client.query<{ id: string }>(
        "SELECT catalog_dataset_version_id AS id FROM dataset_heads WHERE dataset_key = 'hero_catalog'",
      );
      expect(head.rows[0].id).toBe(first);
      const rollback = await client.query<{
        from_version_id: string;
        actor: string;
      }>(
        "SELECT from_version_id, actor FROM catalog_rollbacks WHERE to_version_id = $1 ORDER BY id DESC LIMIT 1",
        [first],
      );
      expect(rollback.rows[0]).toMatchObject({
        from_version_id: second,
        actor: "medota2_worker",
      });
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  });

  it("enforces canonical Hero and Ability constraints", async () => {
    const result = await owner.query<{ constraints: number }>(
      `SELECT count(*)::int AS constraints
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname IN ('heroes', 'abilities') AND c.contype = 'c'`,
    );
    expect(result.rows[0].constraints).toBeGreaterThanOrEqual(12);
  });
});

async function insertVersion(
  client: PoolClient,
  gate: "green" | "yellow" | "red",
): Promise<string> {
  identity += 1;
  const digit = String(identity % 10);
  const snapshot = await client.query<{ id: string }>(
    `INSERT INTO source_snapshots
      (source_repository, source_remote_url, source_commit, manifest_sha256, source_dirty,
       source_inputs_match_head, client_version, source_revision)
     VALUES ($1, 'https://example.invalid/fixture', $2, $3, false, true, 'fixture', 'fixture')
     RETURNING id`,
    [`integration-fixture-${identity}`, digit.repeat(40), digit.repeat(64)],
  );
  const run = await client.query<{ id: string }>(
    `INSERT INTO import_runs
      (source_kind, status, stage, medota2_commit, transformer_version, target_schema_version)
     VALUES ('vpk', 'running', 'integration-test', $1, $2, $3) RETURNING id`,
    [
      digit.repeat(40),
      `catalog-test-${identity}`,
      await currentTargetSchemaVersion(),
    ],
  );
  const version = await client.query<{ id: string }>(
    `INSERT INTO hero_catalog_dataset_versions
      (source_snapshot_id, import_run_id, importer_version, target_schema_version, status,
       selector_version, selector_manifest_sha256, semantic_sha256,
       gate_status, review_status, gate_summary, source_counts)
     VALUES ($1, $2, $3, $4, 'candidate', 'test-selector', $5, $6, $7, $8, '{}', '{}')
     RETURNING id`,
    [
      snapshot.rows[0].id,
      run.rows[0].id,
      `catalog-test-${identity}`,
      await currentTargetSchemaVersion(),
      digit.repeat(64),
      String((identity + 1) % 10).repeat(64),
      gate,
      gate === "yellow" ? "pending" : "not_required",
    ],
  );
  return version.rows[0].id;
}

function requiredTestUrl(key: string): string {
  const value = process.env[key];
  if (!value || !value.includes("_test")) {
    throw new Error(`${key} must point to an explicitly named test database.`);
  }
  return value;
}
