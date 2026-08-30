import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { performance } from "node:perf_hooks";
import { from as copyFrom } from "pg-copy-streams";
import pg, { type Pool, type PoolClient } from "pg";
import {
  assertSourceImportBuildIsClean,
  readBuildIdentity,
} from "@/config/build-identity";
import { getDatabaseUrl, getRequiredPath } from "@/config/env";
import { HeroImportValidationError, type CanonicalHero } from "@/domain/heroes";
import {
  HERO_IMPORT_LOCK_KEYS,
  VPK_SOURCE_PATHS,
  VPK_SOURCE_REPOSITORY,
} from "@/importers/dota-vpk/constants";
import { parseHeroDataset } from "@/importers/dota-vpk/hero-adapter";
import { parseSteamInf } from "@/importers/dota-vpk/steam";
import {
  inspectGitCheckout,
  type GitCheckoutSnapshot,
} from "@/importers/git-checkout";
import { runMigrations } from "@/server/db/run-migrations";
import {
  createImportRun,
  failImportRun,
  prepareWorker,
  startMetrics,
  updateRunStage,
} from "./worker-utils";

interface SnapshotIdentity {
  id: string;
}

const { Pool: PgPool } = pg;

async function main(): Promise<void> {
  const localPreview = process.argv.includes("--local-preview");
  const metrics = startMetrics();
  const build = await readBuildIdentity();
  const importerVersion = `hero-vpk-v1/${build.buildId}${localPreview ? "/local-preview" : ""}`;

  if (localPreview) await resetLocalPreviewDatabase();

  const { pool, targetSchemaVersion } = await prepareWorker(
    localPreview ? "test" : "main",
  );
  const runId = await createImportRun(pool, {
    sourceKind: "vpk",
    commit: build.commit,
    transformerVersion: importerVersion,
    targetSchemaVersion,
  });
  let stage = "validate_build";

  try {
    if (!localPreview) assertSourceImportBuildIsClean(build);
    await updateRunStage(pool, runId, stage);

    stage = "inspect_source";
    await updateRunStage(pool, runId, stage);
    const sourcePath = getRequiredPath("DOTA_VPK_UPDATES_PATH");
    const snapshot = await inspectGitCheckout(sourcePath, VPK_SOURCE_PATHS);
    const steam = parseSteamInf(
      snapshot.files.find((file) => file.path === "steam.inf")!.text,
    );
    const sourceSnapshot = await persistSourceSnapshot(pool, snapshot, steam);
    await pool.query(
      `UPDATE import_runs
       SET source_snapshot_id = $2, source_dirty = $3, source_inputs_match_head = $4
       WHERE id = $1`,
      [runId, sourceSnapshot.id, snapshot.dirty, snapshot.inputsMatchHead],
    );

    stage = "parse_and_validate";
    await updateRunStage(pool, runId, stage);
    const dataset = parseHeroDataset(snapshot.files);

    stage = "persist_and_promote";
    await updateRunStage(pool, runId, stage);
    const dbWriteStart = performance.now();
    const result = await persistDataset(pool, {
      runId,
      sourceSnapshotId: sourceSnapshot.id,
      importerVersion,
      targetSchemaVersion,
      heroes: dataset.heroes,
      counts: dataset.counts,
      issues: dataset.issues,
    });
    const finalMetrics = metrics.finish({
      inputBytes: snapshot.files.reduce((sum, file) => sum + file.sizeBytes, 0),
      outputHeroes: dataset.heroes.length,
      databaseWriteMs:
        Math.round((performance.now() - dbWriteStart) * 100) / 100,
      idempotent: result.idempotent,
    });
    await pool.query(
      "UPDATE import_runs SET metrics = $2::jsonb WHERE id = $1",
      [runId, JSON.stringify(finalMetrics)],
    );

    console.log(
      JSON.stringify(
        {
          runId,
          datasetVersionId: result.datasetVersionId,
          accepted: dataset.counts.accepted,
          warnings: dataset.counts.warnings,
          sourceCommit: snapshot.commit,
          clientVersion: steam.clientVersion,
          sourceRevision: steam.sourceRevision,
          idempotent: result.idempotent,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const validation =
      error instanceof HeroImportValidationError ? error : null;
    await failImportRun(pool, runId, stage, error, metrics.finish(), {
      issues: validation?.issues,
      counts: validation?.counts,
    });
    throw error;
  } finally {
    await pool.end();
  }
}

async function resetLocalPreviewDatabase(): Promise<void> {
  const databaseUrl = getDatabaseUrl("migration", "test");
  await runMigrations(databaseUrl);
  const pool = new PgPool({ connectionString: databaseUrl, max: 1 });
  try {
    const database = await pool.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    if (!database.rows[0].name.endsWith("_test")) {
      throw new Error("Local preview refuses to reset a non-test database.");
    }
    await pool.query(
      "TRUNCATE source_snapshots, import_runs, reference_snapshots CASCADE",
    );
  } finally {
    await pool.end();
  }
}

async function persistSourceSnapshot(
  pool: Pool,
  snapshot: GitCheckoutSnapshot,
  steam: ReturnType<typeof parseSteamInf>,
): Promise<SnapshotIdentity> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query<SnapshotIdentity>(
      `INSERT INTO source_snapshots
        (source_repository, source_remote_url, source_commit, manifest_sha256, source_dirty,
         source_inputs_match_head, client_version, source_revision, version_date, version_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (source_repository, source_commit, manifest_sha256) DO NOTHING
       RETURNING id`,
      [
        VPK_SOURCE_REPOSITORY,
        snapshot.remoteUrl,
        snapshot.commit,
        snapshot.manifestSha256,
        snapshot.dirty,
        snapshot.inputsMatchHead,
        steam.clientVersion,
        steam.sourceRevision,
        steam.versionDate,
        steam.versionTime,
      ],
    );
    const identity =
      inserted.rows[0] ??
      (
        await client.query<SnapshotIdentity>(
          `SELECT id FROM source_snapshots
           WHERE source_repository = $1 AND source_commit = $2 AND manifest_sha256 = $3`,
          [VPK_SOURCE_REPOSITORY, snapshot.commit, snapshot.manifestSha256],
        )
      ).rows[0];

    for (const file of snapshot.files) {
      await client.query(
        `INSERT INTO source_snapshot_files
          (source_snapshot_id, source_path, raw_sha256, size_bytes, encoding)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (source_snapshot_id, source_path) DO NOTHING`,
        [identity.id, file.path, file.sha256, file.sizeBytes, file.encoding],
      );
    }
    const fileCount = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM source_snapshot_files WHERE source_snapshot_id = $1",
      [identity.id],
    );
    if (Number(fileCount.rows[0].count) !== snapshot.files.length) {
      throw new Error(
        "Persisted source snapshot file manifest does not match the checked allowlist.",
      );
    }
    await client.query("COMMIT");
    return identity;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function persistDataset(
  pool: Pool,
  input: {
    runId: string;
    sourceSnapshotId: string;
    importerVersion: string;
    targetSchemaVersion: string;
    heroes: CanonicalHero[];
    counts: Record<string, number>;
    issues: unknown[];
  },
): Promise<{ datasetVersionId: string; idempotent: boolean }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ...HERO_IMPORT_LOCK_KEYS,
    ]);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM hero_dataset_versions
       WHERE source_snapshot_id = $1 AND importer_version = $2 AND target_schema_version = $3`,
      [
        input.sourceSnapshotId,
        input.importerVersion,
        input.targetSchemaVersion,
      ],
    );
    if (existing.rowCount) {
      const datasetVersionId = existing.rows[0].id;
      await client.query("SELECT promote_hero_dataset_version($1)", [
        datasetVersionId,
      ]);
      await client.query(
        `UPDATE import_runs
         SET status = 'succeeded', stage = 'complete', counts = $2::jsonb, issues = $3::jsonb,
             result_dataset_version_id = $4, finished_at = now()
         WHERE id = $1`,
        [
          input.runId,
          JSON.stringify(input.counts),
          JSON.stringify(input.issues),
          datasetVersionId,
        ],
      );
      await client.query("COMMIT");
      return { datasetVersionId, idempotent: true };
    }

    await copyStagingHeroes(client, input.runId, input.heroes);
    const staged = await client.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM hero_import_staging WHERE import_run_id = $1",
      [input.runId],
    );
    if (Number(staged.rows[0].count) !== input.heroes.length) {
      throw new Error("Staging row count does not match validated hero count.");
    }

    const version = await client.query<{ id: string }>(
      `INSERT INTO hero_dataset_versions
        (source_snapshot_id, import_run_id, importer_version, target_schema_version, status)
       VALUES ($1, $2, $3, $4, 'validated')
       RETURNING id`,
      [
        input.sourceSnapshotId,
        input.runId,
        input.importerVersion,
        input.targetSchemaVersion,
      ],
    );
    const datasetVersionId = version.rows[0].id;
    await materializeCanonicalTables(client, input.runId, datasetVersionId);
    await client.query("SELECT promote_hero_dataset_version($1)", [
      datasetVersionId,
    ]);
    await client.query(
      `UPDATE import_runs
       SET status = 'succeeded', stage = 'complete', counts = $2::jsonb, issues = $3::jsonb,
           result_dataset_version_id = $4, finished_at = now()
       WHERE id = $1`,
      [
        input.runId,
        JSON.stringify(input.counts),
        JSON.stringify(input.issues),
        datasetVersionId,
      ],
    );
    await client.query(
      "DELETE FROM hero_import_staging WHERE import_run_id = $1",
      [input.runId],
    );
    await client.query("COMMIT");
    return { datasetVersionId, idempotent: false };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function copyStagingHeroes(
  client: PoolClient,
  runId: string,
  heroes: CanonicalHero[],
): Promise<void> {
  const rows = heroes.map(
    (hero) => `${runId},${hero.heroId},${csv(JSON.stringify(hero))}\n`,
  );
  const destination = client.query(
    copyFrom(
      "COPY hero_import_staging (import_run_id, hero_id, payload) FROM STDIN WITH (FORMAT csv)",
    ),
  );
  await pipeline(Readable.from(rows), destination);
}

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function materializeCanonicalTables(
  client: PoolClient,
  runId: string,
  datasetVersionId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO heroes (
       dataset_version_id, hero_id, internal_name, slug, enabled, cm_enabled, random_enabled,
       primary_attribute, attack_type, faction, complexity,
       base_strength, strength_gain, base_agility, agility_gain, base_intelligence, intelligence_gain,
       base_health, base_mana, base_health_regen, base_mana_regen, base_armor, magic_resistance,
       base_attack_damage_min, base_attack_damage_max, base_attack_speed, attack_rate,
       attack_animation_point, attack_range, projectile_speed, movement_speed, turn_rate,
       day_vision, night_vision
     )
     SELECT $2, s.hero_id, p->>'internalName', p->>'slug', (p->>'enabled')::boolean,
       (p->>'cmEnabled')::boolean, (p->>'randomEnabled')::boolean,
       p->>'primaryAttribute', p->>'attackType', p->>'faction', (p->>'complexity')::smallint,
       (p->>'baseStrength')::numeric, (p->>'strengthGain')::numeric,
       (p->>'baseAgility')::numeric, (p->>'agilityGain')::numeric,
       (p->>'baseIntelligence')::numeric, (p->>'intelligenceGain')::numeric,
       (p->>'baseHealth')::numeric, (p->>'baseMana')::numeric,
       (p->>'baseHealthRegen')::numeric, (p->>'baseManaRegen')::numeric,
       (p->>'baseArmor')::numeric, (p->>'magicResistance')::numeric,
       (p->>'baseAttackDamageMin')::numeric, (p->>'baseAttackDamageMax')::numeric,
       (p->>'baseAttackSpeed')::numeric, (p->>'attackRate')::numeric,
       (p->>'attackAnimationPoint')::numeric, (p->>'attackRange')::numeric,
       (p->>'projectileSpeed')::numeric, (p->>'movementSpeed')::numeric,
       (p->>'turnRate')::numeric, (p->>'dayVision')::numeric, (p->>'nightVision')::numeric
     FROM hero_import_staging s
     CROSS JOIN LATERAL (SELECT s.payload AS p) payload
     WHERE s.import_run_id = $1`,
    [runId, datasetVersionId],
  );

  await client.query(
    `INSERT INTO hero_source_records
       (dataset_version_id, hero_id, source_key, source_dto_sha256, inherited_fields)
     SELECT $2, s.hero_id, s.payload->'source'->>'sourceKey',
       s.payload->'source'->>'sourceDtoSha256',
       ARRAY(SELECT jsonb_array_elements_text(s.payload->'source'->'inheritedFields'))
     FROM hero_import_staging s
     WHERE s.import_run_id = $1`,
    [runId, datasetVersionId],
  );

  await client.query(
    `INSERT INTO hero_roles (dataset_version_id, hero_id, role, role_level)
     SELECT $2, s.hero_id, role->>'role', (role->>'level')::smallint
     FROM hero_import_staging s
     CROSS JOIN LATERAL jsonb_array_elements(s.payload->'roles') role
     WHERE s.import_run_id = $1`,
    [runId, datasetVersionId],
  );

  await client.query(
    `INSERT INTO hero_localizations (
       dataset_version_id, hero_id, locale, display_name, english_name_variant, hype, lore,
       name_source_path, name_token, english_name_variant_token,
       hype_source_path, hype_token, lore_source_path, lore_token
     )
     SELECT $2, s.hero_id, loc->>'locale', loc->>'displayName', loc->>'englishNameVariant',
       loc->>'hype', loc->>'lore', loc->>'nameSourcePath', loc->>'nameToken',
       loc->>'englishNameVariantToken', loc->>'hypeSourcePath', loc->>'hypeToken',
       loc->>'loreSourcePath', loc->>'loreToken'
     FROM hero_import_staging s
     CROSS JOIN LATERAL jsonb_array_elements(s.payload->'localizations') loc
     WHERE s.import_run_id = $1`,
    [runId, datasetVersionId],
  );

  const counts = await client.query<{ heroes: string; localizations: string }>(
    `SELECT
       (SELECT count(*) FROM heroes WHERE dataset_version_id = $1)::text AS heroes,
       (SELECT count(*) FROM hero_localizations WHERE dataset_version_id = $1)::text AS localizations`,
    [datasetVersionId],
  );
  const staged = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM hero_import_staging WHERE import_run_id = $1",
    [runId],
  );
  const expected = Number(staged.rows[0].count);
  if (
    Number(counts.rows[0].heroes) !== expected ||
    Number(counts.rows[0].localizations) !== expected * 2
  ) {
    throw new Error(
      "Canonical row counts failed post-materialization validation.",
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
