import type { PoolClient } from "pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadLocalEnv } from "@/config/env";
import { ASSET_IMPORT_LOCK_KEYS } from "@/domain/assets";
import { CATALOG_IMPORT_LOCK_KEYS } from "@/importers/dota-vpk/constants";
import { sha256 } from "@/lib/hash";
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
      "TRUNCATE source_snapshots, import_runs, reference_snapshots, asset_blobs CASCADE",
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
          'catalog_semantic_diffs', 'catalog_reviews', 'catalog_rollbacks',
          'asset_blobs', 'asset_objects', 'asset_variants', 'asset_dataset_versions',
          'entity_asset_bindings', 'asset_dataset_heads')`,
    );
    expect(tables.rows.map((row) => row.table_name).sort()).toEqual([
      "abilities",
      "asset_blobs",
      "asset_dataset_heads",
      "asset_dataset_versions",
      "asset_objects",
      "asset_variants",
      "catalog_reviews",
      "catalog_rollbacks",
      "catalog_semantic_diffs",
      "entity_asset_bindings",
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
    await expect(
      worker.query(
        "UPDATE asset_dataset_heads SET updated_at = now() WHERE false",
      ),
    ).rejects.toThrow(/permission denied/u);
    await expect(
      worker.query(
        `INSERT INTO asset_refs
          (dataset_version_id, entity_type, entity_key, asset_kind, logical_path,
           cache_status, provider_version)
         VALUES ('00000000-0000-0000-0000-000000000000', 'hero', 'legacy',
           'icon', 'legacy', 'available', 'legacy')`,
      ),
    ).rejects.toThrow(/permission denied/u);
  });

  it("requires the asset lock, exact entity keys, real content hashes and all LoDs", async () => {
    const client = await worker.connect();
    let promotedAsset: InsertedAssetDataset | undefined;
    try {
      await client.query("BEGIN");
      const catalogVersionId = await insertVersion(client, "green", {
        publishAssets: false,
      });

      await client.query("SAVEPOINT invalid_content_hash");
      await expect(
        client.query(
          `INSERT INTO asset_blobs
            (content_sha256, mime_type, width, height, byte_size, content)
           VALUES ($1, 'image/png', 1, 1, 3, $2)`,
          ["0".repeat(64), Buffer.from([1, 2, 3])],
        ),
      ).rejects.toThrow(/asset_blobs_content_sha256_matches_content/u);
      await client.query("ROLLBACK TO SAVEPOINT invalid_content_hash");

      promotedAsset = await insertAssetDataset(client, catalogVersionId);
      await client.query("SAVEPOINT missing_asset_lock");
      await expect(
        client.query("SELECT promote_asset_dataset_version($1)", [
          promotedAsset.id,
        ]),
      ).rejects.toThrow(/asset import advisory lock is required/u);
      await client.query("ROLLBACK TO SAVEPOINT missing_asset_lock");

      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ...ASSET_IMPORT_LOCK_KEYS,
      ]);
      const swapped = await insertAssetDataset(client, catalogVersionId, {
        heroKey: FIXTURE_ABILITY_KEY,
        abilityKey: FIXTURE_HERO_KEY,
      });
      await client.query("SAVEPOINT swapped_entity_keys");
      await expect(
        client.query("SELECT promote_asset_dataset_version($1)", [swapped.id]),
      ).rejects.toThrow(/hero entity keys do not match its catalog/u);
      await client.query("ROLLBACK TO SAVEPOINT swapped_entity_keys");

      const inconsistentResolution = await insertAssetDataset(
        client,
        catalogVersionId,
        { resolutionKind: "exact" },
      );
      await client.query("SAVEPOINT inconsistent_resolution");
      await expect(
        client.query("SELECT promote_asset_dataset_version($1)", [
          inconsistentResolution.id,
        ]),
      ).rejects.toThrow(/resolution kind does not match/u);
      await client.query("ROLLBACK TO SAVEPOINT inconsistent_resolution");

      const partial = await insertAssetDataset(client, catalogVersionId, {
        lods: ["original", "w64", "w128"],
      });
      await client.query("SAVEPOINT partial_lods");
      await expect(
        client.query("SELECT promote_asset_dataset_version($1)", [partial.id]),
      ).rejects.toThrow(/without all required renditions/u);
      await client.query("ROLLBACK TO SAVEPOINT partial_lods");

      await client.query("SELECT promote_asset_dataset_version($1)", [
        promotedAsset.id,
      ]);
      const head = await client.query<{ id: string }>(
        "SELECT asset_dataset_version_id AS id FROM asset_dataset_heads WHERE catalog_dataset_version_id = $1",
        [catalogVersionId],
      );
      expect(head.rows[0].id).toBe(promotedAsset.id);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    expect(promotedAsset).toBeDefined();
    const roundTrip = await web.query<{ content: Buffer }>(
      "SELECT content FROM asset_blobs WHERE content_sha256 = $1",
      [promotedAsset!.blobSha256],
    );
    expect(roundTrip.rows[0].content).toEqual(promotedAsset!.bytes);
  });

  it("requires the asset lock while atomically checking a catalog promotion", async () => {
    const client = await worker.connect();
    try {
      await client.query("BEGIN");
      const candidate = await insertVersion(client, "green");
      await client.query("COMMIT");

      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ...CATALOG_IMPORT_LOCK_KEYS,
      ]);
      await expect(
        client.query("SELECT promote_hero_catalog_version($1)", [candidate]),
      ).rejects.toThrow(
        /asset import advisory lock is required for catalog promotion/u,
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("does not promote or roll back the catalog head without a complete asset head", async () => {
    const client = await worker.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ...CATALOG_IMPORT_LOCK_KEYS,
      ]);
      const current = await insertVersion(client, "green");
      await client.query("SELECT promote_hero_catalog_version($1)", [current]);

      const candidateWithoutAssets = await insertVersion(client, "green", {
        publishAssets: false,
      });
      await client.query("SAVEPOINT candidate_without_assets");
      await expect(
        client.query("SELECT promote_hero_catalog_version($1)", [
          candidateWithoutAssets,
        ]),
      ).rejects.toThrow(/matching complete asset head/u);
      await client.query("ROLLBACK TO SAVEPOINT candidate_without_assets");

      const rollbackTargetWithoutAssets = await insertVersion(client, "green", {
        publishAssets: false,
        status: "validated",
      });
      await client.query("SAVEPOINT rollback_without_assets");
      await expect(
        client.query(
          "SELECT rollback_hero_catalog_version($1, 'missing assets')",
          [rollbackTargetWithoutAssets],
        ),
      ).rejects.toThrow(/matching complete asset head/u);
      await client.query("ROLLBACK TO SAVEPOINT rollback_without_assets");

      const head = await client.query<{ id: string }>(
        "SELECT catalog_dataset_version_id AS id FROM dataset_heads WHERE dataset_key = 'hero_catalog'",
      );
      expect(head.rows[0].id).toBe(current);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  it("blocks a cross-catalog native coverage ratio downgrade unless explicitly allowed", async () => {
    const client = await worker.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ...CATALOG_IMPORT_LOCK_KEYS,
      ]);
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ...ASSET_IMPORT_LOCK_KEYS,
      ]);

      const current = await insertVersion(client, "green", {
        publishAssets: false,
      });
      const currentAssets = await insertAssetDataset(client, current, {
        objectSourceType: "exact",
      });
      await client.query("SELECT promote_asset_dataset_version($1)", [
        currentAssets.id,
      ]);
      await client.query("SELECT promote_hero_catalog_version($1)", [current]);

      const target = await insertVersion(client, "green", {
        publishAssets: false,
      });
      await client.query(
        `INSERT INTO abilities
          (dataset_version_id, internal_name, declaration_kind, definition_kind, catalog_status,
           is_innate, is_passive, is_hidden, is_ultimate, has_scepter_upgrade,
           has_shard_upgrade, is_granted_by_scepter, is_granted_by_shard, texture_name,
           raw_sha256, resolved_sha256)
         VALUES ($1, $2, 'top_level', 'ability', 'current',
           false, false, false, false, false, false, false, false, $2, $3, $3)`,
        [target, FIXTURE_EXTRA_ABILITY_KEY, sha256("extra-ability")],
      );
      const targetAssets = await insertAssetDataset(client, target, {
        objectSourceType: "exact",
      });
      const fallbackObject = await insertAssetDataset(client, target);
      await client.query(
        `INSERT INTO entity_asset_bindings
          (asset_dataset_version_id, entity_type, entity_key, asset_kind, asset_object_id,
           resolution_kind, source_status, requested_logical_path)
         VALUES ($1, 'ability', $2, 'icon', $3, 'generated_fallback', 'fallback',
           'panorama/images/spellicons/fixture_extra_ability_png.vtex_c')`,
        [targetAssets.id, FIXTURE_EXTRA_ABILITY_KEY, fallbackObject.objectId],
      );
      await client.query("SELECT promote_asset_dataset_version($1)", [
        targetAssets.id,
      ]);

      await client.query("SAVEPOINT coverage_regression");
      await expect(
        client.query("SELECT promote_hero_catalog_version($1)", [target]),
      ).rejects.toThrow(
        /exact 2\/2 -> 2\/3, native 2\/2 -> 2\/3.*allow-fallback-downgrade/u,
      );
      await client.query("ROLLBACK TO SAVEPOINT coverage_regression");

      await client.query("SELECT promote_hero_catalog_version($1, true)", [
        target,
      ]);
      const head = await client.query<{ id: string }>(
        "SELECT catalog_dataset_version_id AS id FROM dataset_heads WHERE dataset_key = 'hero_catalog'",
      );
      expect(head.rows[0].id).toBe(target);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
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
  options: {
    publishAssets?: boolean;
    status?: "candidate" | "validated";
  } = {},
): Promise<string> {
  identity += 1;
  const digit = String(identity % 10);
  const schemaVersion = await currentTargetSchemaVersion();
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
    [digit.repeat(40), `catalog-test-${identity}`, schemaVersion],
  );
  const version = await client.query<{ id: string }>(
    `INSERT INTO hero_catalog_dataset_versions
      (source_snapshot_id, import_run_id, importer_version, target_schema_version, status,
       selector_version, selector_manifest_sha256, semantic_sha256,
       gate_status, review_status, gate_summary, source_counts)
     VALUES ($1, $2, $3, $4, $5, 'test-selector', $6, $7, $8, $9, '{}', '{}')
     RETURNING id`,
    [
      snapshot.rows[0].id,
      run.rows[0].id,
      `catalog-test-${identity}`,
      schemaVersion,
      options.status ?? "candidate",
      digit.repeat(64),
      String((identity + 1) % 10).repeat(64),
      gate,
      gate === "yellow" ? "pending" : "not_required",
    ],
  );
  const versionId = version.rows[0].id;
  await client.query(
    `INSERT INTO heroes (
      dataset_version_id, hero_id, internal_name, slug, enabled, cm_enabled, random_enabled,
      primary_attribute, attack_type, faction, complexity,
      base_strength, strength_gain, base_agility, agility_gain,
      base_intelligence, intelligence_gain, base_health, base_mana,
      base_health_regen, base_mana_regen, base_armor, magic_resistance,
      base_attack_damage_min, base_attack_damage_max, base_attack_speed, attack_rate,
      attack_animation_point, attack_range, projectile_speed, movement_speed,
      turn_rate, day_vision, night_vision
    ) VALUES (
      $1, 999999, $2, 'fixture', true, true, true,
      'strength', 'melee', 'radiant', 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
    )`,
    [versionId, FIXTURE_HERO_KEY],
  );
  await client.query(
    `INSERT INTO abilities
      (dataset_version_id, internal_name, declaration_kind, definition_kind, catalog_status,
       is_innate, is_passive, is_hidden, is_ultimate, has_scepter_upgrade,
       has_shard_upgrade, is_granted_by_scepter, is_granted_by_shard, texture_name,
       raw_sha256, resolved_sha256)
     VALUES ($1, $2, 'top_level', 'ability', 'current',
       false, false, false, false, false, false, false, false, $2, $3, $3)`,
    [versionId, FIXTURE_ABILITY_KEY, sha256(`ability-${identity}`)],
  );

  if (options.publishAssets ?? true) {
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ...ASSET_IMPORT_LOCK_KEYS,
    ]);
    const assetDataset = await insertAssetDataset(client, versionId);
    await client.query("SELECT promote_asset_dataset_version($1)", [
      assetDataset.id,
    ]);
  }
  return versionId;
}

const FIXTURE_HERO_KEY = "npc_dota_hero_fixture";
const FIXTURE_ABILITY_KEY = "fixture_ability";
const FIXTURE_EXTRA_ABILITY_KEY = "fixture_extra_ability";
const ASSET_LODS = [
  { key: "original", targetWidth: null, width: 512 },
  { key: "w64", targetWidth: 64, width: 64 },
  { key: "w128", targetWidth: 128, width: 128 },
  { key: "w256", targetWidth: 256, width: 256 },
] as const;
type AssetLodKey = (typeof ASSET_LODS)[number]["key"];

interface InsertedAssetDataset {
  id: string;
  objectId: string;
  blobSha256: string;
  bytes: Buffer;
}

let assetIdentity = 0;

async function insertAssetDataset(
  client: PoolClient,
  catalogVersionId: string,
  options: {
    heroKey?: string;
    abilityKey?: string;
    lods?: readonly AssetLodKey[];
    resolutionKind?: "exact" | "alias" | "generated_fallback";
    objectSourceType?: "exact" | "alias" | "generated_fallback";
  } = {},
): Promise<InsertedAssetDataset> {
  assetIdentity += 1;
  const selectedLods = new Set<AssetLodKey>(
    options.lods ?? ASSET_LODS.map((lod) => lod.key),
  );
  const blobs = new Map<AssetLodKey, { bytes: Buffer; sha256: string }>();
  for (const lod of ASSET_LODS) {
    if (!selectedLods.has(lod.key)) continue;
    const bytes = Buffer.from(
      `integration-asset-${assetIdentity}-${lod.key}`,
      "utf8",
    );
    const contentSha256 = sha256(bytes);
    await client.query(
      `INSERT INTO asset_blobs
        (content_sha256, mime_type, width, height, byte_size, content)
       VALUES ($1, 'image/png', $2, $2, $3, $4)`,
      [contentSha256, lod.width, bytes.length, bytes],
    );
    blobs.set(lod.key, { bytes, sha256: contentSha256 });
  }
  const original = blobs.get("original");
  if (!original)
    throw new Error("Asset fixture requires an original rendition.");

  const object = await client.query<{ id: string }>(
    `INSERT INTO asset_objects
      (object_sha256, asset_kind, logical_path, source_type, source_content_sha256,
       original_blob_sha256, provider_version)
     VALUES ($1, 'icon', $2, $3, $4, $4, 'integration-test')
     RETURNING id`,
    [
      sha256(`asset-object-${assetIdentity}`),
      `generated/fixture-${assetIdentity}.png`,
      options.objectSourceType ?? "generated_fallback",
      original.sha256,
    ],
  );
  for (const lod of ASSET_LODS) {
    const blob = blobs.get(lod.key);
    if (!blob) continue;
    await client.query(
      `INSERT INTO asset_variants
        (asset_object_id, lod_key, target_width, blob_sha256, transformer_version, quality)
       VALUES ($1, $2, $3, $4, 'integration-test', $5)`,
      [
        object.rows[0].id,
        lod.key,
        lod.targetWidth,
        blob.sha256,
        lod.targetWidth === null ? null : 75,
      ],
    );
  }

  const dataset = await client.query<{ id: string }>(
    `INSERT INTO asset_dataset_versions
      (catalog_dataset_version_id, manifest_sha256, client_version, provider_version,
       lod_policy_version, source_counts)
     VALUES ($1, $2, 'fixture', 'integration-test', 'integration-test',
       '{"heroes":1,"abilities":1,"total":2}'::jsonb)
     RETURNING id`,
    [catalogVersionId, sha256(`asset-dataset-${assetIdentity}`)],
  );
  await client.query(
    `INSERT INTO entity_asset_bindings
      (asset_dataset_version_id, entity_type, entity_key, asset_kind, asset_object_id,
       resolution_kind, source_status, requested_logical_path)
     VALUES
       ($1, 'hero', $2, 'icon', $4, $5, $6,
        'panorama/images/heroes/selection/fixture_png.vtex_c'),
       ($1, 'ability', $3, 'icon', $4, $5, $6,
        'panorama/images/spellicons/fixture_ability_png.vtex_c')`,
    [
      dataset.rows[0].id,
      options.heroKey ?? FIXTURE_HERO_KEY,
      options.abilityKey ?? FIXTURE_ABILITY_KEY,
      object.rows[0].id,
      options.resolutionKind ??
        options.objectSourceType ??
        "generated_fallback",
      (options.resolutionKind ??
        options.objectSourceType ??
        "generated_fallback") === "generated_fallback"
        ? "fallback"
        : "available",
    ],
  );
  return {
    id: dataset.rows[0].id,
    objectId: object.rows[0].id,
    blobSha256: original.sha256,
    bytes: original.bytes,
  };
}

function requiredTestUrl(key: string): string {
  const value = process.env[key];
  if (!value || !value.includes("_test")) {
    throw new Error(`${key} must point to an explicitly named test database.`);
  }
  return value;
}
