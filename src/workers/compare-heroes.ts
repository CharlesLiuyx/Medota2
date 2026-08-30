import type { PoolClient } from "pg";
import {
  assertSourceImportBuildIsClean,
  readBuildIdentity,
} from "@/config/build-identity";
import {
  compareReferenceHeroes,
  type CanonicalComparisonHero,
  type ReferenceComparisonHero,
} from "@/importers/dotaconstants/comparator";
import {
  createImportRun,
  failImportRun,
  prepareWorker,
  startMetrics,
  updateRunStage,
} from "./worker-utils";

async function main(): Promise<void> {
  const metrics = startMetrics();
  const build = await readBuildIdentity();
  const comparatorVersion = `hero-reference-v1/${build.buildId}`;
  const { pool, targetSchemaVersion } = await prepareWorker();
  const runId = await createImportRun(pool, {
    sourceKind: "comparison",
    commit: build.commit,
    transformerVersion: comparatorVersion,
    targetSchemaVersion,
  });
  let stage = "validate_build";

  try {
    assertSourceImportBuildIsClean(build);
    stage = "load_paired_snapshots";
    await updateRunStage(pool, runId, stage);
    const client = await pool.connect();
    let result: {
      comparisonId: string;
      diffCount: number;
      matchedCount: number;
      idempotent: boolean;
    };
    try {
      await client.query("BEGIN");
      const dataset = await client.query<{ id: string }>(
        `SELECT v.id
         FROM dataset_heads h
         JOIN hero_catalog_dataset_versions v ON v.id = h.catalog_dataset_version_id
         WHERE h.dataset_key = 'hero_catalog'`,
      );
      if (!dataset.rowCount)
        throw new Error(
          "No active hero dataset. Run pnpm data:import:vpk first.",
        );
      const reference = await client.query<{ id: string }>(
        "SELECT id FROM reference_snapshots ORDER BY imported_at DESC, id DESC LIMIT 1",
      );
      if (!reference.rowCount) {
        throw new Error(
          "No dotaconstants reference snapshot. Run pnpm data:import:dotaconstants first.",
        );
      }
      result = await compareAndPersist(
        client,
        runId,
        dataset.rows[0].id,
        reference.rows[0].id,
        comparatorVersion,
        metrics,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    console.log(JSON.stringify({ runId, ...result }, null, 2));
  } catch (error) {
    await failImportRun(pool, runId, stage, error, metrics.finish());
    throw error;
  } finally {
    await pool.end();
  }
}

async function compareAndPersist(
  client: PoolClient,
  runId: string,
  datasetVersionId: string,
  referenceSnapshotId: string,
  comparatorVersion: string,
  metrics: ReturnType<typeof startMetrics>,
): Promise<{
  comparisonId: string;
  diffCount: number;
  matchedCount: number;
  idempotent: boolean;
}> {
  const existing = await client.query<{
    id: string;
    diff_count: number;
    matched_count: number;
  }>(
    `SELECT id, diff_count, matched_count FROM hero_reference_comparisons
     WHERE dataset_version_id = $1 AND reference_snapshot_id = $2 AND comparator_version = $3`,
    [datasetVersionId, referenceSnapshotId, comparatorVersion],
  );
  if (existing.rowCount) {
    const row = existing.rows[0];
    await finishRun(
      client,
      runId,
      row.id,
      row.diff_count,
      row.matched_count,
      true,
      metrics.finish({ idempotent: true }),
    );
    return {
      comparisonId: row.id,
      diffCount: row.diff_count,
      matchedCount: row.matched_count,
      idempotent: true,
    };
  }

  const canonical = await client.query<CanonicalComparisonHero>(
    `SELECT h.hero_id, h.internal_name, h.primary_attribute, h.attack_type,
       ARRAY(SELECT role FROM hero_roles r WHERE r.dataset_version_id = h.dataset_version_id AND r.hero_id = h.hero_id ORDER BY role) AS roles,
       h.base_health, h.base_mana, h.base_health_regen, h.base_mana_regen, h.base_armor,
       h.magic_resistance, h.base_attack_damage_min, h.base_attack_damage_max,
       h.base_strength, h.base_agility, h.base_intelligence,
       h.strength_gain, h.agility_gain, h.intelligence_gain,
       h.attack_range, h.projectile_speed, h.attack_rate, h.attack_animation_point,
       h.base_attack_speed, h.movement_speed, h.turn_rate, h.cm_enabled,
       h.day_vision, h.night_vision, en.display_name AS english_name
     FROM heroes h
     JOIN hero_localizations en ON en.dataset_version_id = h.dataset_version_id
       AND en.hero_id = h.hero_id AND en.locale = 'en'
     WHERE h.dataset_version_id = $1
     ORDER BY h.hero_id`,
    [datasetVersionId],
  );
  const reference = await client.query<ReferenceComparisonHero>(
    `SELECT hero_id, internal_name, raw_record
     FROM reference_hero_records WHERE reference_snapshot_id = $1 ORDER BY hero_id`,
    [referenceSnapshotId],
  );
  const compared = compareReferenceHeroes(canonical.rows, reference.rows);
  const comparison = await client.query<{ id: string }>(
    `INSERT INTO hero_reference_comparisons
      (dataset_version_id, reference_snapshot_id, import_run_id, comparator_version,
       canonical_count, reference_count, matched_count, diff_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      datasetVersionId,
      referenceSnapshotId,
      runId,
      comparatorVersion,
      canonical.rowCount,
      reference.rowCount,
      compared.matchedCount,
      compared.diffs.length,
    ],
  );
  const comparisonId = comparison.rows[0].id;
  for (const diff of compared.diffs) {
    await client.query(
      `INSERT INTO hero_reference_diffs
        (comparison_id, hero_id, field_name, diff_type, canonical_value, reference_value)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
      [
        comparisonId,
        diff.heroId,
        diff.fieldName,
        diff.diffType,
        JSON.stringify(diff.canonicalValue),
        JSON.stringify(diff.referenceValue),
      ],
    );
  }
  await finishRun(
    client,
    runId,
    comparisonId,
    compared.diffs.length,
    compared.matchedCount,
    false,
    metrics.finish({
      canonicalRecords: canonical.rowCount,
      referenceRecords: reference.rowCount,
      outputDiffs: compared.diffs.length,
      idempotent: false,
    }),
  );
  return {
    comparisonId,
    diffCount: compared.diffs.length,
    matchedCount: compared.matchedCount,
    idempotent: false,
  };
}

async function finishRun(
  client: PoolClient,
  runId: string,
  comparisonId: string,
  diffCount: number,
  matchedCount: number,
  idempotent: boolean,
  metrics: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `UPDATE import_runs
     SET status = 'succeeded', stage = 'complete',
         counts = $2::jsonb, issues = '[]'::jsonb, result_comparison_id = $3,
         metrics = $4::jsonb, finished_at = now()
     WHERE id = $1`,
    [
      runId,
      JSON.stringify({ matched: matchedCount, diffs: diffCount, idempotent }),
      comparisonId,
      JSON.stringify(metrics),
    ],
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
