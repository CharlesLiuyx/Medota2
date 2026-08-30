import { performance } from "node:perf_hooks";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { from as copyFrom } from "pg-copy-streams";
import pg, { type Pool, type PoolClient } from "pg";
import {
  assertSourceImportBuildIsClean,
  readBuildIdentity,
} from "@/config/build-identity";
import { getDatabaseUrl, getRequiredPath } from "@/config/env";
import {
  evaluateCatalogGate,
  projectCatalog,
  type CatalogGateResult,
} from "@/domain/catalog-diff";
import {
  AbilityImportValidationError,
  type ParsedAbilityDataset,
} from "@/domain/abilities";
import {
  ASSET_IMPORT_LOCK_KEYS,
  type PreparedAssetDataset,
} from "@/domain/assets";
import {
  HeroImportValidationError,
  type CanonicalHero,
  type ImportIssue,
} from "@/domain/heroes";
import { parseAbilityDataset } from "@/importers/dota-vpk/ability-adapter";
import {
  ABILITY_DERIVATION_VERSION,
  CATALOG_IMPORT_LOCK_KEYS,
  CATALOG_SELECTOR_VERSION,
  CATALOG_STATIC_SOURCE_PATHS,
  HERO_ABILITY_SOURCE_PATTERN,
  HERO_ABILITY_SOURCE_PREFIX,
  VPK_SOURCE_REPOSITORY,
} from "@/importers/dota-vpk/constants";
import { parseHeroDataset } from "@/importers/dota-vpk/hero-adapter";
import { parseSteamInf } from "@/importers/dota-vpk/steam";
import {
  discoverTrackedPaths,
  inspectGitCheckout,
  type GitCheckoutSnapshot,
} from "@/importers/git-checkout";
import { canonicalJsonSha256 } from "@/lib/hash";
import {
  loadCatalogSourceLock,
  prepareCatalogSourceWorktree,
  verifySnapshotAgainstLock,
} from "@/importers/catalog-source-lock";
import { prepareCatalogAssets } from "@/importers/valve-assets/catalog-assets";
import { publishAssetDataset } from "@/server/assets/asset-store";
import { loadCatalogProjection } from "@/server/catalog-projection";
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

interface StagingRow {
  entityType: "hero" | "ability" | "id_mapping" | "binding" | "facet";
  entityKey: string;
  ordinal: number;
  payload: unknown;
}

const { Pool: PgPool } = pg;

async function main(): Promise<void> {
  const localPreview = process.argv.includes("--local-preview");
  const noPromote = process.argv.includes("--no-promote");
  const allowFallbackDowngrade = process.argv.includes(
    "--allow-fallback-downgrade",
  );
  const downloadMissingAssets = process.argv.includes("--download-missing");
  const metrics = startMetrics();
  const build = await readBuildIdentity();
  const importerVersion = `hero-catalog-v2/${build.buildId}${localPreview ? "/local-preview" : ""}`;

  if (localPreview) await resetLocalPreviewDatabase();
  const { pool, targetSchemaVersion } = await prepareWorker(
    localPreview ? "local" : "main",
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
    const lockIndex = process.argv.indexOf("--lock");
    const sourceLock =
      lockIndex >= 0
        ? await loadCatalogSourceLock(
            process.argv[lockIndex + 1] ||
              (() => {
                throw new Error("--lock requires a lock file path.");
              })(),
          )
        : null;
    const sourcePath = sourceLock
      ? await prepareCatalogSourceWorktree(sourceLock)
      : getRequiredPath("DOTA_VPK_UPDATES_PATH");
    const dynamicPaths = await discoverTrackedPaths(
      sourcePath,
      HERO_ABILITY_SOURCE_PREFIX,
      HERO_ABILITY_SOURCE_PATTERN,
    );
    const snapshot = await inspectGitCheckout(sourcePath, [
      ...CATALOG_STATIC_SOURCE_PATHS,
      ...dynamicPaths,
    ]);
    if (sourceLock) verifySnapshotAgainstLock(sourceLock, snapshot);
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
    const heroDataset = parseHeroDataset(snapshot.files);
    const abilityDataset = parseAbilityDataset(
      snapshot.files,
      heroDataset.heroes,
    );
    const selectorManifestSha256 =
      sourceLock?.selectorManifestSha256 ?? canonicalJsonSha256(dynamicPaths);
    const assetDataset = await prepareCatalogAssets(
      heroDataset.heroes,
      abilityDataset.abilities,
      steam.clientVersion,
      {
        catalogSourceCommit: snapshot.commit,
        downloadMissing: downloadMissingAssets,
      },
    );

    stage = "persist_diff_and_gate";
    await updateRunStage(pool, runId, stage);
    const dbWriteStart = performance.now();
    const result = await persistCatalog(pool, {
      runId,
      sourceSnapshotId: sourceSnapshot.id,
      importerVersion,
      targetSchemaVersion,
      selectorManifestSha256,
      heroes: heroDataset.heroes,
      abilities: abilityDataset,
      counts: { heroes: heroDataset.counts, abilities: abilityDataset.counts },
      issues: [...heroDataset.issues, ...abilityDataset.issues],
      assetDataset,
      noPromote,
      allowFallbackDowngrade,
    });
    const finalMetrics = metrics.finish({
      inputBytes: snapshot.files.reduce((sum, file) => sum + file.sizeBytes, 0),
      outputHeroes: heroDataset.heroes.length,
      outputAbilities: abilityDataset.abilities.length,
      outputBindings: abilityDataset.bindings.length,
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
          catalogVersionId: result.catalogVersionId,
          gate: result.gate,
          promoted: result.promoted,
          reviewStatus: result.reviewStatus,
          sourceCommit: snapshot.commit,
          clientVersion: steam.clientVersion,
          sourceRevision: steam.sourceRevision,
          counts: {
            heroes: heroDataset.counts,
            abilities: abilityDataset.counts,
          },
          idempotent: result.idempotent,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const validation =
      error instanceof HeroImportValidationError ||
      error instanceof AbilityImportValidationError
        ? error
        : null;
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
  const databaseUrl = getDatabaseUrl("migration", "local");
  await runMigrations(databaseUrl);
  const pool = new PgPool({ connectionString: databaseUrl, max: 1 });
  try {
    const database = await pool.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    const configuredDatabase = new URL(databaseUrl).pathname.replace(
      /^\//u,
      "",
    );
    if (
      database.rows[0].name !== configuredDatabase ||
      !database.rows[0].name.endsWith("_local")
    ) {
      throw new Error(
        "Local preview refuses to reset anything except its configured _local database.",
      );
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
    const count = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM source_snapshot_files WHERE source_snapshot_id = $1",
      [identity.id],
    );
    if (count.rows[0].count !== snapshot.files.length) {
      throw new Error(
        "Persisted source manifest does not match checked inputs.",
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

async function persistCatalog(
  pool: Pool,
  input: {
    runId: string;
    sourceSnapshotId: string;
    importerVersion: string;
    targetSchemaVersion: string;
    selectorManifestSha256: string;
    heroes: CanonicalHero[];
    abilities: ParsedAbilityDataset;
    counts: Record<string, unknown>;
    issues: ImportIssue[];
    assetDataset: PreparedAssetDataset;
    noPromote: boolean;
    allowFallbackDowngrade: boolean;
  },
): Promise<{
  catalogVersionId: string;
  gate: CatalogGateResult["gate"];
  reviewStatus: string;
  promoted: boolean;
  idempotent: boolean;
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ...CATALOG_IMPORT_LOCK_KEYS,
    ]);
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ...ASSET_IMPORT_LOCK_KEYS,
    ]);
    const existing = await client.query<{
      id: string;
      gate_status: CatalogGateResult["gate"];
      review_status: string;
    }>(
      `SELECT id, gate_status, review_status FROM hero_catalog_dataset_versions
       WHERE source_snapshot_id = $1 AND importer_version = $2
         AND target_schema_version = $3 AND selector_version = $4`,
      [
        input.sourceSnapshotId,
        input.importerVersion,
        input.targetSchemaVersion,
        CATALOG_SELECTOR_VERSION,
      ],
    );
    if (existing.rowCount) {
      const version = existing.rows[0];
      await publishAssetDataset(client, version.id, input.assetDataset, {
        allowFallbackDowngrade: input.allowFallbackDowngrade,
      });
      const canPromote =
        !input.noPromote &&
        (version.gate_status === "green" ||
          (version.gate_status === "yellow" &&
            version.review_status === "approved"));
      if (canPromote) {
        await client.query("SELECT promote_hero_catalog_version($1, $2)", [
          version.id,
          input.allowFallbackDowngrade,
        ]);
      }
      await finishRun(client, input, version.id, canPromote);
      await client.query("COMMIT");
      return {
        catalogVersionId: version.id,
        gate: version.gate_status,
        reviewStatus: version.review_status,
        promoted: canPromote,
        idempotent: true,
      };
    }

    const currentHead = await client.query<{ id: string }>(
      "SELECT catalog_dataset_version_id AS id FROM dataset_heads WHERE dataset_key = 'hero_catalog'",
    );
    const currentProjection = currentHead.rowCount
      ? await loadCatalogProjection(client, currentHead.rows[0].id)
      : null;
    const gate = applyAssetGate(
      evaluateCatalogGate(
        currentProjection,
        projectCatalog(
          input.heroes,
          input.abilities,
          input.selectorManifestSha256,
        ),
      ),
      input.assetDataset,
    );
    const reviewStatus = gate.gate === "yellow" ? "pending" : "not_required";

    await copyCatalogStaging(
      client,
      input.runId,
      stagingRows(input.heroes, input.abilities),
    );
    const version = await client.query<{ id: string }>(
      `INSERT INTO hero_catalog_dataset_versions
        (source_snapshot_id, import_run_id, importer_version, target_schema_version,
         selector_version, selector_manifest_sha256, semantic_sha256, status,
         gate_status, review_status, gate_summary, source_counts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'candidate', $8, $9, $10::jsonb, $11::jsonb)
       RETURNING id`,
      [
        input.sourceSnapshotId,
        input.runId,
        input.importerVersion,
        input.targetSchemaVersion,
        CATALOG_SELECTOR_VERSION,
        input.selectorManifestSha256,
        gate.semanticSha256,
        gate.gate,
        reviewStatus,
        JSON.stringify(gate.summary),
        JSON.stringify(input.counts),
      ],
    );
    const catalogVersionId = version.rows[0].id;
    await materializeCatalog(client, input.runId, catalogVersionId);
    await publishAssetDataset(client, catalogVersionId, input.assetDataset, {
      allowFallbackDowngrade: input.allowFallbackDowngrade,
    });
    await persistDiffs(client, catalogVersionId, gate);
    await validateMaterialization(client, catalogVersionId, input);

    const promoted = gate.gate === "green" && !input.noPromote;
    if (promoted) {
      await client.query("SELECT promote_hero_catalog_version($1, $2)", [
        catalogVersionId,
        input.allowFallbackDowngrade,
      ]);
    }
    await finishRun(client, input, catalogVersionId, promoted);
    await client.query(
      "DELETE FROM catalog_import_staging WHERE import_run_id = $1",
      [input.runId],
    );
    await client.query("COMMIT");
    return {
      catalogVersionId,
      gate: gate.gate,
      reviewStatus,
      promoted,
      idempotent: false,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function applyAssetGate(
  gate: CatalogGateResult,
  assets: PreparedAssetDataset,
): CatalogGateResult {
  const mismatches = assets.counts.mismatched;
  const errors = assets.counts.errors;
  if (mismatches === 0 && errors === 0) return gate;
  const diffKind =
    mismatches > 0 ? "asset_client_version_mismatch" : "asset_provider_errors";
  gate.diffs.push({
    severity: "yellow",
    diffKind,
    entityType: "asset",
    entityKey: "catalog",
    fieldName: "coverage",
    beforeValue: null,
    afterValue: { mismatches, errors, total: assets.counts.total },
  });
  gate.gate = "yellow";
  gate.summary.total += 1;
  gate.summary.yellow += 1;
  gate.summary.reasons[diffKind] = 1;
  return gate;
}

function stagingRows(
  heroes: readonly CanonicalHero[],
  abilities: ParsedAbilityDataset,
): StagingRow[] {
  return [
    ...heroes.map((payload) => ({
      entityType: "hero" as const,
      entityKey: String(payload.heroId),
      ordinal: 0,
      payload,
    })),
    ...abilities.abilities.map((payload) => ({
      entityType: "ability" as const,
      entityKey: payload.internalName,
      ordinal: 0,
      payload,
    })),
    ...abilities.idMappings.map((payload, ordinal) => ({
      entityType: "id_mapping" as const,
      entityKey: payload.internalName,
      ordinal,
      payload,
    })),
    ...abilities.bindings.map((payload, ordinal) => ({
      entityType: "binding" as const,
      entityKey: [
        payload.heroId,
        payload.abilityInternalName,
        payload.relationKind,
        payload.sourceSlot,
      ].join("\u001f"),
      ordinal,
      payload,
    })),
    ...abilities.facets.map((payload) => ({
      entityType: "facet" as const,
      entityKey: `${payload.heroId}\u001f${payload.facetKey}`,
      ordinal: 0,
      payload,
    })),
  ];
}

async function copyCatalogStaging(
  client: PoolClient,
  runId: string,
  rows: StagingRow[],
): Promise<void> {
  const source = rows.map((row) =>
    [
      runId,
      row.entityType,
      csv(row.entityKey),
      row.ordinal,
      csv(JSON.stringify(row.payload)),
    ].join(","),
  );
  const destination = client.query(
    copyFrom(
      "COPY catalog_import_staging (import_run_id, entity_type, entity_key, ordinal, payload) FROM STDIN WITH (FORMAT csv)",
    ),
  );
  await pipeline(Readable.from(source.map((row) => `${row}\n`)), destination);
  const count = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM catalog_import_staging WHERE import_run_id = $1",
    [runId],
  );
  if (count.rows[0].count !== rows.length) {
    throw new Error(
      "Catalog staging row count does not match parsed entities.",
    );
  }
}

function csv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function materializeCatalog(
  client: PoolClient,
  runId: string,
  datasetVersionId: string,
): Promise<void> {
  await materializeHeroes(client, runId, datasetVersionId);
  await materializeAbilities(client, runId, datasetVersionId);
  await materializeRelations(client, runId, datasetVersionId);
  await materializeSources(client, runId, datasetVersionId);
}

async function materializeHeroes(
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
       day_vision, night_vision)
     SELECT $2, (payload->>'heroId')::integer, payload->>'internalName', payload->>'slug',
       (payload->>'enabled')::boolean, (payload->>'cmEnabled')::boolean,
       (payload->>'randomEnabled')::boolean, payload->>'primaryAttribute', payload->>'attackType',
       payload->>'faction', (payload->>'complexity')::smallint,
       (payload->>'baseStrength')::numeric, (payload->>'strengthGain')::numeric,
       (payload->>'baseAgility')::numeric, (payload->>'agilityGain')::numeric,
       (payload->>'baseIntelligence')::numeric, (payload->>'intelligenceGain')::numeric,
       (payload->>'baseHealth')::numeric, (payload->>'baseMana')::numeric,
       (payload->>'baseHealthRegen')::numeric, (payload->>'baseManaRegen')::numeric,
       (payload->>'baseArmor')::numeric, (payload->>'magicResistance')::numeric,
       (payload->>'baseAttackDamageMin')::numeric, (payload->>'baseAttackDamageMax')::numeric,
       (payload->>'baseAttackSpeed')::numeric, (payload->>'attackRate')::numeric,
       (payload->>'attackAnimationPoint')::numeric, (payload->>'attackRange')::numeric,
       (payload->>'projectileSpeed')::numeric, (payload->>'movementSpeed')::numeric,
       (payload->>'turnRate')::numeric, (payload->>'dayVision')::numeric, (payload->>'nightVision')::numeric
     FROM catalog_import_staging WHERE import_run_id = $1 AND entity_type = 'hero'`,
    [runId, datasetVersionId],
  );
  await client.query(
    `INSERT INTO hero_source_records
       (dataset_version_id, hero_id, source_key, source_dto_sha256, inherited_fields)
     SELECT $2, (payload->>'heroId')::integer, payload->'source'->>'sourceKey',
       payload->'source'->>'sourceDtoSha256',
       ARRAY(SELECT jsonb_array_elements_text(payload->'source'->'inheritedFields'))
     FROM catalog_import_staging WHERE import_run_id = $1 AND entity_type = 'hero'`,
    [runId, datasetVersionId],
  );
  await client.query(
    `INSERT INTO hero_roles (dataset_version_id, hero_id, role, role_level)
     SELECT $2, (s.payload->>'heroId')::integer, role->>'role', (role->>'level')::smallint
     FROM catalog_import_staging s
     CROSS JOIN LATERAL jsonb_array_elements(s.payload->'roles') role
     WHERE s.import_run_id = $1 AND s.entity_type = 'hero'`,
    [runId, datasetVersionId],
  );
  await client.query(
    `INSERT INTO hero_localizations (
       dataset_version_id, hero_id, locale, display_name, english_name_variant, hype, lore,
       name_source_path, name_token, english_name_variant_token,
       hype_source_path, hype_token, lore_source_path, lore_token)
     SELECT $2, (s.payload->>'heroId')::integer, loc->>'locale', loc->>'displayName',
       loc->>'englishNameVariant', loc->>'hype', loc->>'lore', loc->>'nameSourcePath',
       loc->>'nameToken', loc->>'englishNameVariantToken', loc->>'hypeSourcePath',
       loc->>'hypeToken', loc->>'loreSourcePath', loc->>'loreToken'
     FROM catalog_import_staging s
     CROSS JOIN LATERAL jsonb_array_elements(s.payload->'localizations') loc
     WHERE s.import_run_id = $1 AND s.entity_type = 'hero'`,
    [runId, datasetVersionId],
  );
}

async function materializeAbilities(
  client: PoolClient,
  runId: string,
  datasetVersionId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO abilities (
       dataset_version_id, internal_name, declaration_kind, definition_kind, catalog_status,
       ability_type, behavior, unit_target_team, unit_target_type, unit_target_flags, damage_type,
       spell_immunity_type, spell_dispellable_type, max_level, is_innate, is_passive, is_hidden,
       is_ultimate, has_scepter_upgrade, has_shard_upgrade, is_granted_by_scepter,
       is_granted_by_shard, cast_range, cast_point, channel_time, cooldown, mana_cost, damage,
       texture_name, base_class, raw_sha256, resolved_sha256, unknown_fields)
     SELECT $2, payload->>'internalName', payload->'source'->>'declarationKind',
       payload->>'definitionKind', payload->>'catalogStatus', payload->>'abilityType',
       ARRAY(SELECT jsonb_array_elements_text(payload->'behavior')),
       ARRAY(SELECT jsonb_array_elements_text(payload->'unitTargetTeam')),
       ARRAY(SELECT jsonb_array_elements_text(payload->'unitTargetType')),
       ARRAY(SELECT jsonb_array_elements_text(payload->'unitTargetFlags')),
       payload->>'damageType', payload->>'spellImmunityType', payload->>'spellDispellableType',
       (payload->>'maxLevel')::integer, (payload->>'isInnate')::boolean,
       (payload->>'isPassive')::boolean, (payload->>'isHidden')::boolean,
       (payload->>'isUltimate')::boolean, (payload->>'hasScepterUpgrade')::boolean,
       (payload->>'hasShardUpgrade')::boolean, (payload->>'isGrantedByScepter')::boolean,
       (payload->>'isGrantedByShard')::boolean, payload->>'castRange', payload->>'castPoint',
       payload->>'channelTime', payload->>'cooldown', payload->>'manaCost', payload->>'damage',
       payload->>'textureName', payload->>'baseClass', payload->'source'->>'rawSha256',
       payload->'source'->>'resolvedSha256',
       ARRAY(SELECT jsonb_array_elements_text(payload->'source'->'unknownFields'))
     FROM catalog_import_staging WHERE import_run_id = $1 AND entity_type = 'ability'`,
    [runId, datasetVersionId],
  );
  await client.query(
    `INSERT INTO ability_values
       (dataset_version_id, ability_internal_name, value_key, ordinal, scalar_value,
        level_values, modifiers, raw_value)
     SELECT $2, s.payload->>'internalName', value->>'valueKey', (value->>'ordinal')::integer,
       value->>'scalarValue', ARRAY(SELECT jsonb_array_elements_text(value->'levelValues')),
       value->'modifiers', value->'rawValue'
     FROM catalog_import_staging s
     CROSS JOIN LATERAL jsonb_array_elements(s.payload->'values') value
     WHERE s.import_run_id = $1 AND s.entity_type = 'ability'`,
    [runId, datasetVersionId],
  );
  await client.query(
    `INSERT INTO ability_localizations (
       dataset_version_id, ability_internal_name, locale, display_name, description, lore,
       scepter_description, shard_description, source_path, name_token, description_token,
       lore_token, scepter_token, shard_token)
     SELECT $2, s.payload->>'internalName', loc->>'locale', loc->>'displayName',
       loc->>'description', loc->>'lore', loc->>'scepterDescription', loc->>'shardDescription',
       loc->>'sourcePath', loc->>'nameToken', loc->>'descriptionToken', loc->>'loreToken',
       loc->>'scepterToken', loc->>'shardToken'
     FROM catalog_import_staging s
     CROSS JOIN LATERAL jsonb_array_elements(s.payload->'localizations') loc
     WHERE s.import_run_id = $1 AND s.entity_type = 'ability'`,
    [runId, datasetVersionId],
  );
  await client.query(
    `INSERT INTO ability_id_mappings
       (dataset_version_id, internal_name, ability_id, source_path, source_line)
     SELECT $2, payload->>'internalName', (payload->>'abilityId')::integer,
       payload->>'sourcePath', (payload->>'sourceLine')::integer
     FROM catalog_import_staging WHERE import_run_id = $1 AND entity_type = 'id_mapping'`,
    [runId, datasetVersionId],
  );
}

async function materializeRelations(
  client: PoolClient,
  runId: string,
  datasetVersionId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO hero_ability_bindings (
       dataset_version_id, hero_id, ability_internal_name, source_slot, relation_kind, ordinal,
       is_current, source_path, source_line, derivation_version)
     SELECT $2, (payload->>'heroId')::integer, payload->>'abilityInternalName',
       payload->>'sourceSlot', payload->>'relationKind', (payload->>'ordinal')::integer,
       (payload->>'isCurrent')::boolean, payload->>'sourcePath',
       (payload->>'sourceLine')::integer, $3
     FROM catalog_import_staging WHERE import_run_id = $1 AND entity_type = 'binding'`,
    [runId, datasetVersionId, ABILITY_DERIVATION_VERSION],
  );
  await client.query(
    `INSERT INTO facets
       (dataset_version_id, hero_id, facet_key, icon, color, gradient_id, deprecated,
        source_path, source_line, raw_definition)
     SELECT $2, (payload->>'heroId')::integer, payload->>'facetKey', payload->>'icon',
       payload->>'color', (payload->>'gradientId')::integer, (payload->>'deprecated')::boolean,
       payload->>'sourcePath', (payload->>'sourceLine')::integer, payload->'rawDefinition'
     FROM catalog_import_staging WHERE import_run_id = $1 AND entity_type = 'facet'`,
    [runId, datasetVersionId],
  );
  await client.query(
    `INSERT INTO facet_ability_bindings
       (dataset_version_id, hero_id, facet_key, ability_internal_name, source_path, source_line)
     SELECT dataset_version_id, hero_id, substring(source_slot from 7), ability_internal_name,
       source_path, source_line
     FROM hero_ability_bindings
     WHERE dataset_version_id = $1 AND relation_kind = 'facet'
     ON CONFLICT DO NOTHING`,
    [datasetVersionId],
  );
}

async function materializeSources(
  client: PoolClient,
  runId: string,
  datasetVersionId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO entity_source_records (
       dataset_version_id, entity_type, entity_key, occurrence_ordinal, source_path, source_line,
       source_key, declaration_kind, raw_definition, resolved_definition, raw_sha256,
       resolved_sha256, inherited_fields, unknown_fields)
     SELECT $2, 'hero', payload->>'internalName', 0, 'scripts/npc/npc_heroes.txt', NULL,
       payload->'source'->>'sourceKey', 'top_level', payload->'source', NULL,
       payload->'source'->>'sourceDtoSha256', NULL,
       ARRAY(SELECT jsonb_array_elements_text(payload->'source'->'inheritedFields')), '{}'
     FROM catalog_import_staging WHERE import_run_id = $1 AND entity_type = 'hero'`,
    [runId, datasetVersionId],
  );
  await client.query(
    `INSERT INTO entity_source_records (
       dataset_version_id, entity_type, entity_key, occurrence_ordinal, source_path, source_line,
       source_key, declaration_kind, raw_definition, resolved_definition, raw_sha256,
       resolved_sha256, inherited_fields, unknown_fields)
     SELECT $2, 'ability', s.payload->>'internalName', occurrence.ordinality - 1,
       occurrence.value->>'path', (occurrence.value->>'line')::integer,
       s.payload->>'internalName', s.payload->'source'->>'declarationKind',
       occurrence.value->'rawDefinition', s.payload->'source'->'resolvedDefinition',
       occurrence.value->>'rawSha256', s.payload->'source'->>'resolvedSha256', '{}',
       ARRAY(SELECT jsonb_array_elements_text(s.payload->'source'->'unknownFields'))
     FROM catalog_import_staging s
     CROSS JOIN LATERAL jsonb_array_elements(s.payload->'source'->'definitionOccurrences')
       WITH ORDINALITY occurrence(value, ordinality)
     WHERE s.import_run_id = $1 AND s.entity_type = 'ability'`,
    [runId, datasetVersionId],
  );
}

async function persistDiffs(
  client: PoolClient,
  catalogVersionId: string,
  gate: CatalogGateResult,
): Promise<void> {
  for (const diff of gate.diffs) {
    await client.query(
      `INSERT INTO catalog_semantic_diffs
        (candidate_version_id, severity, diff_kind, entity_type, entity_key,
         field_name, before_value, after_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
      [
        catalogVersionId,
        diff.severity,
        diff.diffKind,
        diff.entityType,
        diff.entityKey,
        diff.fieldName,
        JSON.stringify(diff.beforeValue),
        JSON.stringify(diff.afterValue),
      ],
    );
  }
}

async function validateMaterialization(
  client: PoolClient,
  catalogVersionId: string,
  input: { heroes: CanonicalHero[]; abilities: ParsedAbilityDataset },
): Promise<void> {
  const counts = await client.query<{
    heroes: number;
    abilities: number;
    bindings: number;
    facets: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM heroes WHERE dataset_version_id = $1) AS heroes,
       (SELECT count(*)::int FROM abilities WHERE dataset_version_id = $1) AS abilities,
       (SELECT count(*)::int FROM hero_ability_bindings WHERE dataset_version_id = $1) AS bindings,
       (SELECT count(*)::int FROM facets WHERE dataset_version_id = $1) AS facets`,
    [catalogVersionId],
  );
  const actual = counts.rows[0];
  if (
    actual.heroes !== input.heroes.length ||
    actual.abilities !== input.abilities.abilities.length ||
    actual.bindings !== input.abilities.bindings.length ||
    actual.facets !== input.abilities.facets.length
  ) {
    throw new Error(
      "Canonical row counts failed post-materialization validation.",
    );
  }
}

async function finishRun(
  client: PoolClient,
  input: {
    runId: string;
    counts: Record<string, unknown>;
    issues: ImportIssue[];
  },
  catalogVersionId: string,
  promoted: boolean,
): Promise<void> {
  await client.query(
    `UPDATE import_runs
     SET status = 'succeeded', stage = $2, counts = $3::jsonb, issues = $4::jsonb,
         result_catalog_version_id = $5, finished_at = now()
     WHERE id = $1`,
    [
      input.runId,
      promoted ? "complete_promoted" : "complete_candidate",
      JSON.stringify(input.counts),
      JSON.stringify(input.issues),
      catalogVersionId,
    ],
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
