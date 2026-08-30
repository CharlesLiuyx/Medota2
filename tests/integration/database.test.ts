import type { PoolClient } from "pg";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocalEnv } from "@/config/env";
import { ASSET_IMPORT_LOCK_KEYS } from "@/domain/assets";
import {
  CATALOG_SLICE_LIMIT,
  type CatalogSlice,
} from "@/domain/catalog-stream";
import { CATALOG_IMPORT_LOCK_KEYS } from "@/importers/dota-vpk/constants";
import { sha256 } from "@/lib/hash";
import type { getAbilityCatalogSlice as GetAbilityCatalogSlice } from "@/server/repositories/abilities";
import type { getHeroCatalogSlice as GetHeroCatalogSlice } from "@/server/repositories/heroes";
import type { AbilityFilters } from "@/server/services/ability-filters";
import type { ListSliceRequest } from "@/server/services/catalog-cursor";
import type { HeroFilters } from "@/server/services/hero-filters";
import {
  assertSchemaCurrent,
  currentTargetSchemaVersion,
} from "@/server/db/migrations";
import { runMigrations } from "@/server/db/run-migrations";

vi.mock("server-only", () => ({}));

const { Pool } = pg;
loadLocalEnv();

const migrationUrl = requiredTestUrl("DATABASE_URL_MIGRATION_TEST");
const workerUrl = requiredTestUrl("DATABASE_URL_WORKER_TEST");
const webUrl = requiredTestUrl("DATABASE_URL_WEB_TEST");
const owner = new Pool({ connectionString: migrationUrl, max: 1 });
const worker = new Pool({ connectionString: workerUrl, max: 1 });
const competingWorker = new Pool({ connectionString: workerUrl, max: 1 });
const web = new Pool({ connectionString: webUrl, max: 1 });
const originalWebUrl = process.env.DATABASE_URL_WEB;
let repositoryWebPool: pg.Pool | undefined;
let getAbilityCatalogSlice: typeof GetAbilityCatalogSlice;
let getHeroCatalogSlice: typeof GetHeroCatalogSlice;
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
    process.env.DATABASE_URL_WEB = webUrl;
    ({ getAbilityCatalogSlice } =
      await import("@/server/repositories/abilities"));
    ({ getHeroCatalogSlice } = await import("@/server/repositories/heroes"));
    repositoryWebPool = (await import("@/server/db/client")).getWebPool();
  });

  afterAll(async () => {
    await Promise.all([
      owner.end(),
      worker.end(),
      competingWorker.end(),
      web.end(),
      repositoryWebPool?.end(),
    ]);
    if (originalWebUrl === undefined) delete process.env.DATABASE_URL_WEB;
    else process.env.DATABASE_URL_WEB = originalWebUrl;
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

  it("keeps bidirectional catalog keysets complete, filtered and pinned across promotion", async () => {
    const previousHead = (
      await owner.query<PreviousCatalogHead>(
        `SELECT catalog_dataset_version_id AS id, updated_at
           FROM dataset_heads WHERE dataset_key = 'hero_catalog'`,
      )
    ).rows[0];
    const fixtures: StreamFixture[] = [];

    try {
      const fixtureClient = await worker.connect();
      try {
        await fixtureClient.query("BEGIN");
        await lockCatalogPromotion(fixtureClient);
        const oldFixture = await insertStreamFixture(
          fixtureClient,
          `stream_old_${identity + 1}`,
          120,
        );
        const newFixture = await insertStreamFixture(
          fixtureClient,
          `stream_new_${identity + 1}`,
          120,
        );
        fixtures.push(oldFixture, newFixture);
        await fixtureClient.query(
          "SELECT promote_hero_catalog_version($1, true)",
          [oldFixture.catalogDatasetVersionId],
        );
        await fixtureClient.query("COMMIT");
      } catch (error) {
        await fixtureClient.query("ROLLBACK");
        throw error;
      } finally {
        fixtureClient.release();
      }

      const [oldFixture, newFixture] = fixtures;
      const abilityFilters = defaultAbilityFilters();
      const heroFilters = defaultHeroFilters();
      const abilityTraversal = await traverseCatalog(
        (request) =>
          getAbilityCatalogSlice(abilityFilters, {
            catalogDatasetVersionId: oldFixture.catalogDatasetVersionId,
            assetDatasetVersionId: oldFixture.assetDatasetVersionId,
            ...request,
          }),
        (ability) => ability.internalName,
      );
      const heroTraversal = await traverseCatalog(
        (request) =>
          getHeroCatalogSlice(heroFilters, {
            catalogDatasetVersionId: oldFixture.catalogDatasetVersionId,
            assetDatasetVersionId: oldFixture.assetDatasetVersionId,
            ...request,
          }),
        (hero) => hero.heroId,
      );
      const abilityBaseline = await abilityBaselineKeys(
        oldFixture.catalogDatasetVersionId,
      );
      const heroBaseline = await heroBaselineKeys(
        oldFixture.catalogDatasetVersionId,
      );

      expect(abilityTraversal.forwardKeys).toEqual(abilityBaseline);
      expect(abilityTraversal.backwardKeys).toEqual(abilityBaseline);
      expect(abilityTraversal.chunkCount).toBeGreaterThanOrEqual(3);
      expect(heroTraversal.forwardKeys).toEqual(heroBaseline);
      expect(heroTraversal.backwardKeys).toEqual(heroBaseline);
      expect(heroTraversal.chunkCount).toBeGreaterThanOrEqual(3);
      expect(heroTraversal.first.groupCounts).toEqual({
        strength: 30,
        agility: 30,
        intelligence: 30,
        universal: 30,
      });

      const tieKeys = [
        `${oldFixture.label}_ability_049`,
        `${oldFixture.label}_ability_050`,
      ];
      const firstTieIndex = abilityTraversal.forwardKeys.indexOf(tieKeys[0]);
      expect(firstTieIndex).toBeGreaterThanOrEqual(0);
      expect(
        abilityTraversal.forwardKeys.slice(firstTieIndex, firstTieIndex + 2),
      ).toEqual(tieKeys);

      const filteredAbilities: AbilityFilters = {
        ...abilityFilters,
        q: `${oldFixture.label}_ability_0`,
        relation: "talent",
        behavior: "DOTA_ABILITY_BEHAVIOR_PASSIVE",
        damage: "DAMAGE_TYPE_MAGICAL",
        upgrade: "scepter",
      };
      const filteredAbilityTraversal = await traverseCatalog(
        (request) =>
          getAbilityCatalogSlice(filteredAbilities, {
            catalogDatasetVersionId: oldFixture.catalogDatasetVersionId,
            assetDatasetVersionId: oldFixture.assetDatasetVersionId,
            ...request,
          }),
        (ability) => ability.internalName,
      );
      expect(filteredAbilityTraversal.forwardKeys).toEqual(
        abilityBaseline.filter((key) => {
          const ordinal = streamOrdinal(key);
          return ordinal < 100 && ordinal % 10 === 0;
        }),
      );

      const heroBoundAbility = await getAbilityCatalogSlice(
        {
          ...abilityFilters,
          hero: `${oldFixture.label}_010`,
        },
        {
          catalogDatasetVersionId: oldFixture.catalogDatasetVersionId,
          assetDatasetVersionId: oldFixture.assetDatasetVersionId,
        },
      );
      expect(heroBoundAbility.items.map((item) => item.internalName)).toEqual([
        `${oldFixture.label}_ability_010`,
      ]);

      const filteredHeroes: HeroFilters = {
        q: oldFixture.label,
        attributes: ["agility"],
        roles: ["support"],
        attacks: ["ranged"],
        cm: "true",
        lang: "zh-CN",
      };
      const filteredHeroTraversal = await traverseCatalog(
        (request) =>
          getHeroCatalogSlice(filteredHeroes, {
            catalogDatasetVersionId: oldFixture.catalogDatasetVersionId,
            assetDatasetVersionId: oldFixture.assetDatasetVersionId,
            ...request,
          }),
        (hero) => hero.heroId,
      );
      expect(filteredHeroTraversal.forwardKeys).toEqual(
        heroBaseline.filter(
          (heroId) => heroId % 4 === 2 && heroId % 2 === 0 && heroId % 3 !== 0,
        ),
      );

      expect(
        (await getAbilityCatalogSlice(abilityFilters)).datasetVersionId,
      ).toBe(oldFixture.catalogDatasetVersionId);
      expect((await getHeroCatalogSlice(heroFilters)).datasetVersionId).toBe(
        oldFixture.catalogDatasetVersionId,
      );

      const promotionClient = await worker.connect();
      try {
        await promotionClient.query("BEGIN");
        await lockCatalogPromotion(promotionClient);
        await promotionClient.query(
          "SELECT promote_hero_catalog_version($1, true)",
          [newFixture.catalogDatasetVersionId],
        );
        await promotionClient.query("COMMIT");
      } catch (error) {
        await promotionClient.query("ROLLBACK");
        throw error;
      } finally {
        promotionClient.release();
      }

      const currentAbilities = await getAbilityCatalogSlice(abilityFilters);
      const currentHeroes = await getHeroCatalogSlice(heroFilters);
      expect(currentAbilities.datasetVersionId).toBe(
        newFixture.catalogDatasetVersionId,
      );
      expect(currentHeroes.datasetVersionId).toBe(
        newFixture.catalogDatasetVersionId,
      );

      const oldAbilityContinuation = await getAbilityCatalogSlice(
        abilityFilters,
        { after: abilityTraversal.first.nextCursor! },
      );
      const oldHeroContinuation = await getHeroCatalogSlice(heroFilters, {
        after: heroTraversal.first.nextCursor!,
      });
      expect(oldAbilityContinuation.datasetVersionId).toBe(
        oldFixture.catalogDatasetVersionId,
      );
      expect(oldAbilityContinuation.assetDatasetVersionId).toBe(
        oldFixture.assetDatasetVersionId,
      );
      expect(
        oldAbilityContinuation.items.every((item) =>
          item.internalName.startsWith(oldFixture.label),
        ),
      ).toBe(true);
      expect(oldHeroContinuation.datasetVersionId).toBe(
        oldFixture.catalogDatasetVersionId,
      );
      expect(oldHeroContinuation.assetDatasetVersionId).toBe(
        oldFixture.assetDatasetVersionId,
      );
      expect(
        oldHeroContinuation.items.every((item) =>
          item.internalName.includes(oldFixture.label),
        ),
      ).toBe(true);
    } finally {
      await cleanupStreamFixtures(fixtures, previousHead);
    }
  }, 60_000);

  it("enforces canonical Hero and Ability constraints", async () => {
    const result = await owner.query<{ constraints: number }>(
      `SELECT count(*)::int AS constraints
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname IN ('heroes', 'abilities') AND c.contype = 'c'`,
    );
    expect(result.rows[0].constraints).toBeGreaterThanOrEqual(12);
  });
});

interface PreviousCatalogHead {
  id: string;
  updated_at: Date;
}

interface StreamFixture {
  label: string;
  catalogDatasetVersionId: string;
  assetDatasetVersionId: string;
  sourceSnapshotId: string;
  importRunId: string;
}

interface CatalogTraversal<T, Key extends string | number> {
  first: CatalogSlice<T>;
  forwardKeys: Key[];
  backwardKeys: Key[];
  chunkCount: number;
}

async function insertStreamFixture(
  client: PoolClient,
  label: string,
  count: number,
): Promise<StreamFixture> {
  const catalogDatasetVersionId = await insertVersion(client, "green", {
    publishAssets: false,
    seedEntities: false,
  });
  const identityRow = (
    await client.query<{
      source_snapshot_id: string;
      import_run_id: string;
    }>(
      `SELECT source_snapshot_id, import_run_id
       FROM hero_catalog_dataset_versions WHERE id = $1`,
      [catalogDatasetVersionId],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO heroes (
       dataset_version_id, hero_id, internal_name, slug, enabled, cm_enabled,
       random_enabled, primary_attribute, attack_type, faction, complexity,
       base_strength, strength_gain, base_agility, agility_gain,
       base_intelligence, intelligence_gain, base_health, base_mana,
       base_health_regen, base_mana_regen, base_armor, magic_resistance,
       base_attack_damage_min, base_attack_damage_max, base_attack_speed,
       attack_rate, attack_animation_point, attack_range, projectile_speed,
       movement_speed, turn_rate, day_vision, night_vision
     )
     SELECT $1, ordinal,
       'npc_dota_hero_' || $2 || '_' || lpad(ordinal::text, 3, '0'),
       $2 || '_' || lpad(ordinal::text, 3, '0'), true,
       ordinal % 3 <> 0, true,
       CASE (ordinal - 1) % 4
         WHEN 0 THEN 'strength'
         WHEN 1 THEN 'agility'
         WHEN 2 THEN 'intelligence'
         ELSE 'universal'
       END,
       CASE WHEN ordinal % 2 = 0 THEN 'ranged' ELSE 'melee' END,
       CASE WHEN ordinal % 2 = 0 THEN 'radiant' ELSE 'dire' END, 1,
       20, 2, 20, 2, 20, 2, 200, 75, 1, 1, 2, 25,
       30, 35, 100, 1.7, 0.3, 150, 900, 300, 0.6, 1800, 800
     FROM generate_series(1, $3::integer) AS ordinal`,
    [catalogDatasetVersionId, label, count],
  );
  await client.query(
    `INSERT INTO hero_localizations (
       dataset_version_id, hero_id, locale, display_name, name_source_path,
       name_token
     )
     SELECT $1, ordinal, locale,
       CASE WHEN locale = 'zh-CN'
         THEN '测试英雄 ' || lpad(ordinal::text, 3, '0')
         ELSE 'Stream Hero ' || lpad(ordinal::text, 3, '0')
       END,
       'resource/localization/' || locale || '.txt',
       'DOTA_Tooltip_hero_' || $2 || '_' || lpad(ordinal::text, 3, '0')
     FROM generate_series(1, $3::integer) AS ordinal
     CROSS JOIN (VALUES ('en'), ('zh-CN')) AS locales(locale)`,
    [catalogDatasetVersionId, label, count],
  );
  await client.query(
    `INSERT INTO hero_roles (dataset_version_id, hero_id, role, role_level)
     SELECT $1, ordinal,
       CASE WHEN ordinal % 2 = 0 THEN 'support' ELSE 'carry' END, 2
     FROM generate_series(1, $2::integer) AS ordinal`,
    [catalogDatasetVersionId, count],
  );

  const abilityHash = sha256(`stream-ability-${label}`);
  await client.query(
    `INSERT INTO abilities (
       dataset_version_id, internal_name, declaration_kind, definition_kind,
       catalog_status, behavior, damage_type, is_innate, is_passive, is_hidden,
       is_ultimate, has_scepter_upgrade, has_shard_upgrade,
       is_granted_by_scepter, is_granted_by_shard, texture_name,
       raw_sha256, resolved_sha256
     )
     SELECT $1, $2 || '_ability_' || lpad(ordinal::text, 3, '0'),
       'top_level', 'ability', 'current',
       CASE WHEN ordinal % 2 = 0
         THEN ARRAY['DOTA_ABILITY_BEHAVIOR_PASSIVE']::text[]
         ELSE ARRAY[]::text[]
       END,
       CASE WHEN ordinal % 2 = 0 THEN 'DAMAGE_TYPE_MAGICAL' ELSE NULL END,
       false, ordinal % 2 = 0, false, false,
       ordinal % 5 = 0, ordinal % 7 = 0,
       ordinal % 5 = 0, ordinal % 7 = 0,
       $2 || '_ability_' || lpad(ordinal::text, 3, '0'), $4, $4
     FROM generate_series(1, $3::integer) AS ordinal`,
    [catalogDatasetVersionId, label, count, abilityHash],
  );
  await client.query(
    `INSERT INTO ability_localizations (
       dataset_version_id, ability_internal_name, locale, display_name,
       source_path, name_token, description_token, lore_token,
       scepter_token, shard_token
     )
     SELECT $1, $2 || '_ability_' || lpad(ordinal::text, 3, '0'), locale,
       CASE
         WHEN locale = 'zh-CN' AND ordinal IN (49, 50) THEN '重复技能名'
         WHEN locale = 'zh-CN' THEN '测试技能 ' || lpad(ordinal::text, 3, '0')
         ELSE 'Stream Ability ' || lpad(ordinal::text, 3, '0')
       END,
       'resource/localization/abilities_' || locale || '.txt',
       'DOTA_Tooltip_ability_' || $2 || '_' || lpad(ordinal::text, 3, '0'),
       '', '', '', ''
     FROM generate_series(1, $3::integer) AS ordinal
     CROSS JOIN (VALUES ('en'), ('zh-CN')) AS locales(locale)`,
    [catalogDatasetVersionId, label, count],
  );
  await client.query(
    `INSERT INTO hero_ability_bindings (
       dataset_version_id, hero_id, ability_internal_name, source_slot,
       relation_kind, ordinal, is_current, source_path, source_line,
       derivation_version
     )
     SELECT $1, ordinal,
       $2 || '_ability_' || lpad(ordinal::text, 3, '0'),
       'slot_' || ordinal,
       CASE WHEN ordinal % 2 = 0 THEN 'talent' ELSE 'loadout' END,
       ordinal, true, 'scripts/npc/' || $2 || '.txt', ordinal,
       'integration-stream-v1'
     FROM generate_series(1, $3::integer) AS ordinal`,
    [catalogDatasetVersionId, label, count],
  );

  const firstHeroKey = `npc_dota_hero_${label}_001`;
  const firstAbilityKey = `${label}_ability_001`;
  const assetDataset = await insertAssetDataset(
    client,
    catalogDatasetVersionId,
    {
      heroKey: firstHeroKey,
      abilityKey: firstAbilityKey,
      objectSourceType: "exact",
    },
  );
  await client.query(
    `INSERT INTO entity_asset_bindings (
       asset_dataset_version_id, entity_type, entity_key, asset_kind,
       asset_object_id, resolution_kind, source_status, requested_logical_path
     )
     SELECT $1, 'hero', internal_name, 'icon', $2, 'exact', 'available',
       'panorama/images/heroes/selection/' || slug || '_png.vtex_c'
     FROM heroes
     WHERE dataset_version_id = $3 AND internal_name <> $4`,
    [
      assetDataset.id,
      assetDataset.objectId,
      catalogDatasetVersionId,
      firstHeroKey,
    ],
  );
  await client.query(
    `INSERT INTO entity_asset_bindings (
       asset_dataset_version_id, entity_type, entity_key, asset_kind,
       asset_object_id, resolution_kind, source_status, requested_logical_path
     )
     SELECT $1, 'ability', internal_name, 'icon', $2, 'exact', 'available',
       'panorama/images/spellicons/' || internal_name || '_png.vtex_c'
     FROM abilities
     WHERE dataset_version_id = $3 AND internal_name <> $4`,
    [
      assetDataset.id,
      assetDataset.objectId,
      catalogDatasetVersionId,
      firstAbilityKey,
    ],
  );
  await client.query("SELECT promote_asset_dataset_version($1)", [
    assetDataset.id,
  ]);

  return {
    label,
    catalogDatasetVersionId,
    assetDatasetVersionId: assetDataset.id,
    sourceSnapshotId: identityRow.source_snapshot_id,
    importRunId: identityRow.import_run_id,
  };
}

async function lockCatalogPromotion(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
    ...CATALOG_IMPORT_LOCK_KEYS,
  ]);
  await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
    ...ASSET_IMPORT_LOCK_KEYS,
  ]);
}

function defaultAbilityFilters(): AbilityFilters {
  return {
    q: "",
    status: "current",
    hero: "",
    relation: "all",
    behavior: "",
    damage: "",
    upgrade: "all",
    lang: "zh-CN",
  };
}

function defaultHeroFilters(): HeroFilters {
  return {
    q: "",
    attributes: [],
    roles: [],
    attacks: [],
    cm: "all",
    lang: "zh-CN",
  };
}

async function traverseCatalog<T, Key extends string | number>(
  load: (request: ListSliceRequest) => Promise<CatalogSlice<T>>,
  getKey: (item: T) => Key,
): Promise<CatalogTraversal<T, Key>> {
  const first = await load({});
  const forwardKeys = first.items.map(getKey);
  let current = first;
  let chunkCount = 1;
  const consumedAfter = new Set<string>();
  while (current.nextCursor) {
    expect(consumedAfter.has(current.nextCursor)).toBe(false);
    consumedAfter.add(current.nextCursor);
    current = await load({ after: current.nextCursor });
    expect(current.total).toBeUndefined();
    expect(current.groupCounts).toBeUndefined();
    expect(current.datasetVersionId).toBe(first.datasetVersionId);
    expect(current.assetDatasetVersionId).toBe(first.assetDatasetVersionId);
    forwardKeys.push(...current.items.map(getKey));
    chunkCount += 1;
    if (chunkCount > 100) throw new Error("forward cursor did not terminate");
  }

  const backwardKeys = current.items.map(getKey);
  let backwardChunks = 1;
  const consumedBefore = new Set<string>();
  while (current.previousCursor) {
    expect(consumedBefore.has(current.previousCursor)).toBe(false);
    consumedBefore.add(current.previousCursor);
    current = await load({ before: current.previousCursor });
    expect(current.total).toBeUndefined();
    expect(current.groupCounts).toBeUndefined();
    backwardKeys.unshift(...current.items.map(getKey));
    backwardChunks += 1;
    if (backwardChunks > 100)
      throw new Error("backward cursor did not terminate");
  }

  expect(backwardChunks).toBe(chunkCount);
  expect(first.total).toBe(forwardKeys.length);
  expect(new Set(forwardKeys).size).toBe(forwardKeys.length);
  expect(backwardKeys).toEqual(forwardKeys);
  expect(first.items.length).toBeLessThanOrEqual(CATALOG_SLICE_LIMIT);
  return { first, forwardKeys, backwardKeys, chunkCount };
}

async function abilityBaselineKeys(
  datasetVersionId: string,
): Promise<string[]> {
  const result = await web.query<{ internal_name: string }>(
    `SELECT a.internal_name
     FROM abilities a
     LEFT JOIN ability_localizations requested
       ON requested.dataset_version_id = a.dataset_version_id
       AND requested.ability_internal_name = a.internal_name
       AND requested.locale = 'zh-CN'
     LEFT JOIN ability_localizations english
       ON english.dataset_version_id = a.dataset_version_id
       AND english.ability_internal_name = a.internal_name
       AND english.locale = 'en'
     WHERE a.dataset_version_id = $1 AND a.catalog_status = 'current'
     ORDER BY COALESCE(requested.display_name, english.display_name,
       a.internal_name) COLLATE "C", a.internal_name COLLATE "C"`,
    [datasetVersionId],
  );
  return result.rows.map((row) => row.internal_name);
}

async function heroBaselineKeys(datasetVersionId: string): Promise<number[]> {
  const result = await web.query<{ hero_id: number }>(
    `SELECT hero_id FROM heroes
     WHERE dataset_version_id = $1
     ORDER BY CASE primary_attribute
       WHEN 'strength' THEN 0
       WHEN 'agility' THEN 1
       WHEN 'intelligence' THEN 2
       WHEN 'universal' THEN 3
       ELSE 4 END, hero_id`,
    [datasetVersionId],
  );
  return result.rows.map((row) => row.hero_id);
}

function streamOrdinal(key: string): number {
  const match = /_(\d{3})$/u.exec(key);
  if (!match) throw new Error(`stream key has no ordinal: ${key}`);
  return Number(match[1]);
}

async function cleanupStreamFixtures(
  fixtures: StreamFixture[],
  previousHead: PreviousCatalogHead | undefined,
): Promise<void> {
  if (fixtures.length === 0) return;
  const catalogIds = fixtures.map((fixture) => fixture.catalogDatasetVersionId);
  const assetDatasetIds = fixtures.map(
    (fixture) => fixture.assetDatasetVersionId,
  );
  const sourceSnapshotIds = fixtures.map((fixture) => fixture.sourceSnapshotId);
  const importRunIds = fixtures.map((fixture) => fixture.importRunId);

  await owner.query("BEGIN");
  try {
    if (previousHead) {
      await owner.query(
        `INSERT INTO dataset_heads
          (dataset_key, catalog_dataset_version_id, updated_at)
         VALUES ('hero_catalog', $1, $2)
         ON CONFLICT (dataset_key) DO UPDATE
         SET catalog_dataset_version_id = EXCLUDED.catalog_dataset_version_id,
             updated_at = EXCLUDED.updated_at`,
        [previousHead.id, previousHead.updated_at],
      );
    } else {
      await owner.query(
        "DELETE FROM dataset_heads WHERE dataset_key = 'hero_catalog'",
      );
    }

    const objectIds = (
      await owner.query<{ id: string }>(
        `SELECT DISTINCT asset_object_id AS id
         FROM entity_asset_bindings
         WHERE asset_dataset_version_id = ANY($1::uuid[])`,
        [assetDatasetIds],
      )
    ).rows.map((row) => row.id);
    const blobHashes = objectIds.length
      ? (
          await owner.query<{ hash: string }>(
            `SELECT DISTINCT blob_sha256 AS hash FROM asset_variants
             WHERE asset_object_id = ANY($1::uuid[])`,
            [objectIds],
          )
        ).rows.map((row) => row.hash)
      : [];

    await owner.query(
      "DELETE FROM asset_dataset_heads WHERE catalog_dataset_version_id = ANY($1::uuid[])",
      [catalogIds],
    );
    await owner.query(
      "DELETE FROM entity_asset_bindings WHERE asset_dataset_version_id = ANY($1::uuid[])",
      [assetDatasetIds],
    );
    await owner.query(
      "DELETE FROM asset_dataset_versions WHERE id = ANY($1::uuid[])",
      [assetDatasetIds],
    );
    if (objectIds.length) {
      await owner.query(
        "DELETE FROM asset_variants WHERE asset_object_id = ANY($1::uuid[])",
        [objectIds],
      );
      await owner.query(
        "DELETE FROM asset_objects WHERE id = ANY($1::uuid[])",
        [objectIds],
      );
    }
    if (blobHashes.length) {
      await owner.query(
        "DELETE FROM asset_blobs WHERE content_sha256 = ANY($1::text[])",
        [blobHashes],
      );
    }

    for (const table of [
      "facet_ability_bindings",
      "facets",
      "hero_ability_bindings",
      "ability_values",
      "ability_localizations",
      "ability_id_mappings",
      "abilities",
      "hero_roles",
      "hero_localizations",
      "hero_source_records",
      "heroes",
      "entity_source_records",
      "asset_refs",
    ]) {
      await owner.query(
        `DELETE FROM ${table} WHERE dataset_version_id = ANY($1::uuid[])`,
        [catalogIds],
      );
    }
    await owner.query(
      "DELETE FROM catalog_semantic_diffs WHERE candidate_version_id = ANY($1::uuid[])",
      [catalogIds],
    );
    await owner.query(
      "DELETE FROM catalog_reviews WHERE candidate_version_id = ANY($1::uuid[])",
      [catalogIds],
    );
    await owner.query(
      `DELETE FROM catalog_rollbacks
       WHERE from_version_id = ANY($1::uuid[]) OR to_version_id = ANY($1::uuid[])`,
      [catalogIds],
    );
    await owner.query(
      "DELETE FROM hero_catalog_dataset_versions WHERE id = ANY($1::uuid[])",
      [catalogIds],
    );
    await owner.query("DELETE FROM import_runs WHERE id = ANY($1::uuid[])", [
      importRunIds,
    ]);
    await owner.query(
      "DELETE FROM source_snapshots WHERE id = ANY($1::uuid[])",
      [sourceSnapshotIds],
    );
    const residual = (
      await owner.query<{ count: number }>(
        `SELECT (
           (SELECT count(*) FROM hero_catalog_dataset_versions
             WHERE id = ANY($1::uuid[]))
           + (SELECT count(*) FROM asset_dataset_versions
             WHERE id = ANY($2::uuid[]))
           + (SELECT count(*) FROM import_runs WHERE id = ANY($3::uuid[]))
           + (SELECT count(*) FROM source_snapshots WHERE id = ANY($4::uuid[]))
         )::int AS count`,
        [catalogIds, assetDatasetIds, importRunIds, sourceSnapshotIds],
      )
    ).rows[0].count;
    if (residual !== 0)
      throw new Error("stream fixture cleanup left rows behind");
    const restoredHead = (
      await owner.query<{ id: string }>(
        `SELECT catalog_dataset_version_id AS id
         FROM dataset_heads WHERE dataset_key = 'hero_catalog'`,
      )
    ).rows[0];
    if (restoredHead?.id !== previousHead?.id) {
      throw new Error(
        "stream fixture cleanup did not restore the catalog head",
      );
    }
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK");
    throw error;
  }
}

async function insertVersion(
  client: PoolClient,
  gate: "green" | "yellow" | "red",
  options: {
    publishAssets?: boolean;
    seedEntities?: boolean;
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
  if (options.seedEntities ?? true) {
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
  }

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
