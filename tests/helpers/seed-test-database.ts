import pg from "pg";
import { loadLocalEnv } from "@/config/env";
import { HERO_IMPORT_LOCK_KEYS } from "@/importers/dota-vpk/constants";
import { parseHeroDataset } from "@/importers/dota-vpk/hero-adapter";
import { parseSteamInf } from "@/importers/dota-vpk/steam";
import { sha256 } from "@/lib/hash";
import { currentTargetSchemaVersion } from "@/server/db/migrations";
import { runMigrations } from "@/server/db/run-migrations";
import { loadVpkFixture } from "./vpk-fixture";

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
    const files = await loadVpkFixture();
    const dataset = parseHeroDataset(files);
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
         $1, $2, false, true, $3, $4, $5, $6, now() - interval '2 minutes') RETURNING id`,
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
        JSON.stringify(dataset.counts),
        JSON.stringify(includeFailure ? dataset.issues : []),
      ],
    );
    const version = await client.query<{ id: string }>(
      `INSERT INTO hero_dataset_versions
        (source_snapshot_id, import_run_id, importer_version, target_schema_version, status)
       VALUES ($1, $2, 'hero-vpk-v1/e2e-fixture', $3, 'validated') RETURNING id`,
      [snapshot.rows[0].id, run.rows[0].id, schemaVersion],
    );
    for (const hero of dataset.heroes)
      await insertHero(client, version.rows[0].id, hero);
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ...HERO_IMPORT_LOCK_KEYS,
    ]);
    await client.query("SELECT promote_hero_dataset_version($1)", [
      version.rows[0].id,
    ]);
    await client.query(
      "UPDATE import_runs SET result_dataset_version_id = $2 WHERE id = $1",
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
      `seeded ${dataset.heroes.length} ${includeFailure ? "E2E" : "demo"} heroes into ${database.rows[0].name}`,
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
