import pg from "pg";
import { loadLocalEnv } from "@/config/env";
import { parseAbilityDataset } from "@/importers/dota-vpk/ability-adapter";
import {
  ABILITY_DERIVATION_VERSION,
  CATALOG_IMPORT_LOCK_KEYS,
  CATALOG_SELECTOR_VERSION,
} from "@/importers/dota-vpk/constants";
import { parseHeroDataset } from "@/importers/dota-vpk/hero-adapter";
import { parseSteamInf } from "@/importers/dota-vpk/steam";
import { sha256 } from "@/lib/hash";
import { currentTargetSchemaVersion } from "@/server/db/migrations";
import { runMigrations } from "@/server/db/run-migrations";
import { loadCatalogFixture } from "./vpk-fixture";

const { Pool } = pg;

async function main(): Promise<void> {
  loadLocalEnv();
  const includeFailure = process.argv.includes("--include-failure");
  const databaseUrl = process.env.DATABASE_URL_MIGRATION_TEST;
  if (!databaseUrl || !databaseUrl.includes("_test"))
    throw new Error("E2E seed requires DATABASE_URL_MIGRATION_TEST.");
  await runMigrations(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const database = await client.query<{ name: string }>(
      "SELECT current_database() AS name",
    );
    if (!database.rows[0].name.endsWith("_test"))
      throw new Error("Refusing to seed a non-test database.");
    const files = await loadCatalogFixture();
    const dataset = parseHeroDataset(files);
    const abilityDataset = parseAbilityDataset(files, dataset.heroes);
    const steam = parseSteamInf(
      files.find((file) => file.path === "steam.inf")!.text,
    );
    const schemaVersion = await currentTargetSchemaVersion();
    const manifestText = [...files]
      .sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)))
      .map((file) => `${file.path}\t${file.sha256}\t${file.sizeBytes}\n`)
      .join("");

    await client.query("BEGIN");
    await client.query(
      "TRUNCATE source_snapshots, import_runs, reference_snapshots CASCADE",
    );
    const snapshot = await client.query<{ id: string }>(
      `INSERT INTO source_snapshots
        (source_repository, source_remote_url, source_commit, manifest_sha256, source_dirty,
         source_inputs_match_head, client_version, source_revision, version_date, version_time, imported_at)
       VALUES ('spirit-bear-productions/dota_vpk_updates', 'https://github.com/spirit-bear-productions/dota_vpk_updates.git',
         $1, $2, false, true, $3, $4, $5, $6, '2026-08-31T00:00:00Z') RETURNING id`,
      [
        "991daaf6fc24b08445209d9ce8767e145bab107e",
        sha256(manifestText),
        steam.clientVersion,
        steam.sourceRevision,
        steam.versionDate,
        steam.versionTime,
      ],
    );
    for (const file of files) {
      await client.query(
        `INSERT INTO source_snapshot_files (source_snapshot_id, source_path, raw_sha256, size_bytes, encoding)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          snapshot.rows[0].id,
          file.path,
          file.sha256,
          file.sizeBytes,
          file.encoding,
        ],
      );
    }
    const run = await client.query<{ id: string }>(
      `INSERT INTO import_runs
        (source_kind, status, stage, source_snapshot_id, medota2_commit, transformer_version,
         target_schema_version, source_dirty, source_inputs_match_head, counts, issues, metrics, finished_at)
       VALUES ('vpk', 'succeeded', 'complete', $1, $2, 'hero-vpk-v1/e2e-fixture', $3,
         false, true, $4::jsonb, $5::jsonb, '{"fixture":true}'::jsonb, now() - interval '1 minute') RETURNING id`,
      [
        snapshot.rows[0].id,
        "4".repeat(40),
        schemaVersion,
        JSON.stringify({
          heroes: dataset.counts,
          abilities: abilityDataset.counts,
        }),
        JSON.stringify(includeFailure ? dataset.issues : []),
      ],
    );
    const version = await client.query<{ id: string }>(
      `INSERT INTO hero_catalog_dataset_versions
        (id, source_snapshot_id, import_run_id, importer_version, target_schema_version, status,
         selector_version, selector_manifest_sha256, semantic_sha256,
         gate_status, review_status, gate_summary, source_counts)
       VALUES ($1, $2, $3, 'hero-catalog-v2/e2e-fixture', $4, 'candidate',
         $5, $6, $7, 'green', 'not_required', '{}', '{}') RETURNING id`,
      [
        "00000000-0000-4000-8000-000000000003",
        snapshot.rows[0].id,
        run.rows[0].id,
        schemaVersion,
        CATALOG_SELECTOR_VERSION,
        "9".repeat(64),
        "a".repeat(64),
      ],
    );
    for (const hero of dataset.heroes)
      await insertHero(client, version.rows[0].id, hero);
    await insertAbilities(client, version.rows[0].id, abilityDataset);
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ...CATALOG_IMPORT_LOCK_KEYS,
    ]);
    await client.query("SELECT promote_hero_catalog_version($1)", [
      version.rows[0].id,
    ]);
    await client.query(
      "UPDATE import_runs SET result_catalog_version_id = $2 WHERE id = $1",
      [run.rows[0].id, version.rows[0].id],
    );

    const reference = await client.query<{ id: string }>(
      `INSERT INTO reference_snapshots
        (source_repository, source_remote_url, source_commit, source_dirty, source_inputs_match_head,
         package_version, heroes_sha256, package_sha256)
       VALUES ('odota/dotaconstants', 'https://github.com/odota/dotaconstants.git', $1, false, true,
         '10.8.0-fixture', $2, $3) RETURNING id`,
      [
        "e7705ee975ebec2a88a59a7b455d4cae5dc69ca1",
        "5".repeat(64),
        "6".repeat(64),
      ],
    );
    await client.query(
      `INSERT INTO reference_hero_records (reference_snapshot_id, hero_id, internal_name, raw_record)
       VALUES ($1, 1, 'npc_dota_hero_antimage', '{"id":1,"name":"npc_dota_hero_antimage","base_health":999}'::jsonb)`,
      [reference.rows[0].id],
    );
    const comparisonRun = await client.query<{ id: string }>(
      `INSERT INTO import_runs
        (source_kind, status, stage, medota2_commit, transformer_version, target_schema_version, counts, finished_at)
       VALUES ('comparison', 'succeeded', 'complete', $1, 'hero-reference-v1/e2e-fixture', $2,
         '{"matched":1,"diffs":2}'::jsonb, now()) RETURNING id`,
      ["7".repeat(40), schemaVersion],
    );
    const comparison = await client.query<{ id: string }>(
      `INSERT INTO hero_reference_comparisons
        (dataset_version_id, reference_snapshot_id, import_run_id, comparator_version,
         canonical_count, reference_count, matched_count, diff_count)
       VALUES ($1, $2, $3, 'hero-reference-v1/e2e-fixture', 2, 1, 1, 2) RETURNING id`,
      [version.rows[0].id, reference.rows[0].id, comparisonRun.rows[0].id],
    );
    await client.query(
      `INSERT INTO hero_reference_diffs
        (comparison_id, hero_id, field_name, diff_type, canonical_value, reference_value)
       VALUES ($1, 1, 'base_health', 'value_mismatch', '120'::jsonb, '999'::jsonb),
              ($1, 999, 'record', 'missing_in_reference', '"npc_dota_hero_test_cm_disabled"'::jsonb, NULL)`,
      [comparison.rows[0].id],
    );
    await client.query(
      "UPDATE import_runs SET result_comparison_id = $2 WHERE id = $1",
      [comparisonRun.rows[0].id, comparison.rows[0].id],
    );
    if (includeFailure) {
      await client.query(
        `INSERT INTO import_runs
          (source_kind, status, stage, medota2_commit, transformer_version, target_schema_version,
           issues, error_summary, started_at, finished_at)
         VALUES ('vpk', 'failed', 'parse_and_validate', $1, 'hero-vpk-v1/e2e-failure', $2,
           '[{"severity":"blocking","code":"fixture_failure","message":"Fixture failure"}]'::jsonb,
           'Fixture failure kept the previous active dataset.', now(), now())`,
        ["8".repeat(40), schemaVersion],
      );
    }
    await client.query("COMMIT");
    console.log(
      `seeded ${dataset.heroes.length} heroes and ${abilityDataset.abilities.length} abilities into ${database.rows[0].name}`,
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function insertHero(
  client: pg.PoolClient,
  versionId: string,
  hero: ReturnType<typeof parseHeroDataset>["heroes"][number],
): Promise<void> {
  await client.query(
    `INSERT INTO heroes VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34
    )`,
    [
      versionId,
      hero.heroId,
      hero.internalName,
      hero.slug,
      hero.enabled,
      hero.cmEnabled,
      hero.randomEnabled,
      hero.primaryAttribute,
      hero.attackType,
      hero.faction,
      hero.complexity,
      hero.baseStrength,
      hero.strengthGain,
      hero.baseAgility,
      hero.agilityGain,
      hero.baseIntelligence,
      hero.intelligenceGain,
      hero.baseHealth,
      hero.baseMana,
      hero.baseHealthRegen,
      hero.baseManaRegen,
      hero.baseArmor,
      hero.magicResistance,
      hero.baseAttackDamageMin,
      hero.baseAttackDamageMax,
      hero.baseAttackSpeed,
      hero.attackRate,
      hero.attackAnimationPoint,
      hero.attackRange,
      hero.projectileSpeed,
      hero.movementSpeed,
      hero.turnRate,
      hero.dayVision,
      hero.nightVision,
    ],
  );
  await client.query(
    `INSERT INTO hero_source_records (dataset_version_id, hero_id, source_key, source_dto_sha256, inherited_fields)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      versionId,
      hero.heroId,
      hero.source.sourceKey,
      hero.source.sourceDtoSha256,
      hero.source.inheritedFields,
    ],
  );
  for (const role of hero.roles) {
    await client.query("INSERT INTO hero_roles VALUES ($1, $2, $3, $4)", [
      versionId,
      hero.heroId,
      role.role,
      role.level,
    ]);
  }
  for (const loc of hero.localizations) {
    await client.query(
      `INSERT INTO hero_localizations VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        versionId,
        hero.heroId,
        loc.locale,
        loc.displayName,
        loc.englishNameVariant,
        loc.hype,
        loc.lore,
        loc.nameSourcePath,
        loc.nameToken,
        loc.englishNameVariantToken,
        loc.hypeSourcePath,
        loc.hypeToken,
        loc.loreSourcePath,
        loc.loreToken,
      ],
    );
  }
}

async function insertAbilities(
  client: pg.PoolClient,
  versionId: string,
  dataset: ReturnType<typeof parseAbilityDataset>,
): Promise<void> {
  for (const ability of dataset.abilities) {
    await client.query(
      `INSERT INTO abilities (
        dataset_version_id, internal_name, declaration_kind, definition_kind, catalog_status,
        ability_type, behavior, unit_target_team, unit_target_type, unit_target_flags,
        damage_type, spell_immunity_type, spell_dispellable_type, max_level,
        is_innate, is_passive, is_hidden, is_ultimate, has_scepter_upgrade, has_shard_upgrade,
        is_granted_by_scepter, is_granted_by_shard, cast_range, cast_point, channel_time,
        cooldown, mana_cost, damage, texture_name, base_class, raw_sha256, resolved_sha256,
        unknown_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)`,
      [
        versionId,
        ability.internalName,
        ability.source.declarationKind,
        ability.definitionKind,
        ability.catalogStatus,
        ability.abilityType,
        ability.behavior,
        ability.unitTargetTeam,
        ability.unitTargetType,
        ability.unitTargetFlags,
        ability.damageType,
        ability.spellImmunityType,
        ability.spellDispellableType,
        ability.maxLevel,
        ability.isInnate,
        ability.isPassive,
        ability.isHidden,
        ability.isUltimate,
        ability.hasScepterUpgrade,
        ability.hasShardUpgrade,
        ability.isGrantedByScepter,
        ability.isGrantedByShard,
        ability.castRange,
        ability.castPoint,
        ability.channelTime,
        ability.cooldown,
        ability.manaCost,
        ability.damage,
        ability.textureName,
        ability.baseClass,
        ability.source.rawSha256,
        ability.source.resolvedSha256,
        ability.source.unknownFields,
      ],
    );
    for (const value of ability.values) {
      await client.query(
        `INSERT INTO ability_values
          (dataset_version_id, ability_internal_name, value_key, ordinal, scalar_value,
           level_values, modifiers, raw_value)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb)`,
        [
          versionId,
          ability.internalName,
          value.valueKey,
          value.ordinal,
          value.scalarValue,
          value.levelValues,
          JSON.stringify(value.modifiers),
          JSON.stringify(value.rawValue),
        ],
      );
    }
    for (const loc of ability.localizations) {
      await client.query(
        `INSERT INTO ability_localizations VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          versionId,
          ability.internalName,
          loc.locale,
          loc.displayName,
          loc.description,
          loc.lore,
          loc.scepterDescription,
          loc.shardDescription,
          loc.sourcePath,
          loc.nameToken,
          loc.descriptionToken,
          loc.loreToken,
          loc.scepterToken,
          loc.shardToken,
        ],
      );
    }
    for (const [
      ordinal,
      occurrence,
    ] of ability.source.definitionOccurrences.entries()) {
      await client.query(
        `INSERT INTO entity_source_records
          (dataset_version_id, entity_type, entity_key, occurrence_ordinal, source_path,
           source_line, source_key, declaration_kind, raw_definition, resolved_definition,
           raw_sha256, resolved_sha256, inherited_fields, unknown_fields)
         VALUES ($1,'ability',$2,$3,$4,$5,$2,$6,$7::jsonb,$8::jsonb,$9,$10,'{}',$11)`,
        [
          versionId,
          ability.internalName,
          ordinal,
          occurrence.path,
          occurrence.line,
          ability.source.declarationKind,
          JSON.stringify(occurrence.rawDefinition),
          JSON.stringify(ability.source.resolvedDefinition),
          occurrence.rawSha256,
          ability.source.resolvedSha256,
          ability.source.unknownFields,
        ],
      );
    }
  }
  for (const mapping of dataset.idMappings) {
    await client.query(
      `INSERT INTO ability_id_mappings
        (dataset_version_id, internal_name, ability_id, source_path, source_line)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        versionId,
        mapping.internalName,
        mapping.abilityId,
        mapping.sourcePath,
        mapping.sourceLine,
      ],
    );
  }
  for (const facet of dataset.facets) {
    await client.query(
      `INSERT INTO facets VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        versionId,
        facet.heroId,
        facet.facetKey,
        facet.icon,
        facet.color,
        facet.gradientId,
        facet.deprecated,
        facet.sourcePath,
        facet.sourceLine,
        JSON.stringify(facet.rawDefinition),
      ],
    );
  }
  for (const binding of dataset.bindings) {
    await client.query(
      `INSERT INTO hero_ability_bindings VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        versionId,
        binding.heroId,
        binding.abilityInternalName,
        binding.sourceSlot,
        binding.relationKind,
        binding.ordinal,
        binding.isCurrent,
        binding.sourcePath,
        binding.sourceLine,
        ABILITY_DERIVATION_VERSION,
      ],
    );
  }
  await client.query(
    `INSERT INTO facet_ability_bindings
      (dataset_version_id, hero_id, facet_key, ability_internal_name, source_path, source_line)
     SELECT dataset_version_id, hero_id, substring(source_slot from 7), ability_internal_name,
       source_path, source_line
     FROM hero_ability_bindings
     WHERE dataset_version_id = $1 AND relation_kind = 'facet'`,
    [versionId],
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
