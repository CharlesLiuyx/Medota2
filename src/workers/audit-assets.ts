import { prepareWorker } from "./worker-utils";

async function main(): Promise<void> {
  const allowGenerated = process.argv.includes("--allow-generated");
  const { pool } = await prepareWorker("read");
  try {
    const active = await pool.query<{
      catalog_id: string;
      asset_id: string | null;
      manifest_sha256: string | null;
    }>(
      `SELECT catalog.catalog_dataset_version_id AS catalog_id,
         asset.asset_dataset_version_id AS asset_id,
         version.manifest_sha256
       FROM dataset_heads catalog
       LEFT JOIN asset_dataset_heads asset
         ON asset.catalog_dataset_version_id = catalog.catalog_dataset_version_id
       LEFT JOIN asset_dataset_versions version
         ON version.id = asset.asset_dataset_version_id
       WHERE catalog.dataset_key = 'hero_catalog'`,
    );
    if (!active.rowCount) throw new Error("No active Hero Catalog exists.");
    const head = active.rows[0];
    if (!head.asset_id) {
      throw new Error(
        "The active Hero Catalog has no published asset dataset. Run data:import:assets.",
      );
    }
    const result = await pool.query<{
      expected_heroes: number;
      expected_abilities: number;
      bound_heroes: number;
      bound_abilities: number;
      missing_heroes: number;
      missing_abilities: number;
      incomplete_lods: number;
      exact: number;
      aliases: number;
      generated_fallbacks: number;
      vpk_sources: number;
      steam_cdn_sources: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM heroes WHERE dataset_version_id = $1) AS expected_heroes,
         (SELECT count(*)::int FROM abilities WHERE dataset_version_id = $1) AS expected_abilities,
         count(*) FILTER (WHERE binding.entity_type = 'hero')::int AS bound_heroes,
         count(*) FILTER (WHERE binding.entity_type = 'ability')::int AS bound_abilities,
         (SELECT count(*)::int FROM heroes hero
          WHERE hero.dataset_version_id = $1 AND NOT EXISTS (
            SELECT 1 FROM entity_asset_bindings candidate
            WHERE candidate.asset_dataset_version_id = $2
              AND candidate.entity_type = 'hero'
              AND candidate.entity_key = hero.internal_name
              AND candidate.asset_kind = 'icon')) AS missing_heroes,
         (SELECT count(*)::int FROM abilities ability
          WHERE ability.dataset_version_id = $1 AND NOT EXISTS (
            SELECT 1 FROM entity_asset_bindings candidate
            WHERE candidate.asset_dataset_version_id = $2
              AND candidate.entity_type = 'ability'
              AND candidate.entity_key = ability.internal_name
              AND candidate.asset_kind = 'icon')) AS missing_abilities,
         count(*) FILTER (WHERE (
           SELECT count(DISTINCT variant.lod_key)
           FROM asset_variants variant
           JOIN asset_blobs blob ON blob.content_sha256 = variant.blob_sha256
           WHERE variant.asset_object_id = binding.asset_object_id
             AND variant.lod_key = ANY('{original,w64,w128,w256}'::text[])
         ) <> 4)::int AS incomplete_lods,
         count(*) FILTER (WHERE binding.resolution_kind = 'exact')::int AS exact,
         count(*) FILTER (WHERE binding.resolution_kind = 'alias')::int AS aliases,
         count(*) FILTER (WHERE binding.resolution_kind = 'generated_fallback')::int
           AS generated_fallbacks,
         count(*) FILTER (
           WHERE asset_object.source_repository = 'Valve Dota 2 client VPK'
         )::int AS vpk_sources,
         count(*) FILTER (
           WHERE asset_object.source_repository = 'Valve Steam static CDN'
         )::int AS steam_cdn_sources
       FROM entity_asset_bindings binding
       JOIN asset_objects asset_object ON asset_object.id = binding.asset_object_id
       WHERE binding.asset_dataset_version_id = $2`,
      [head.catalog_id, head.asset_id],
    );
    const coverage = result.rows[0];
    const complete =
      coverage.bound_heroes === coverage.expected_heroes &&
      coverage.bound_abilities === coverage.expected_abilities &&
      coverage.missing_heroes === 0 &&
      coverage.missing_abilities === 0 &&
      coverage.incomplete_lods === 0;
    const valveAssetComplete = coverage.generated_fallbacks === 0;
    const accepted = complete && (allowGenerated || valveAssetComplete);
    console.log(
      JSON.stringify(
        {
          catalogDatasetVersionId: head.catalog_id,
          assetDatasetVersionId: head.asset_id,
          assetManifestSha256: head.manifest_sha256,
          displayCoverage: complete ? "100%" : "incomplete",
          valveAssetCoverage: valveAssetComplete ? "100%" : "incomplete",
          acceptance: accepted ? "passed" : "failed",
          ...coverage,
        },
        null,
        2,
      ),
    );
    if (!accepted) {
      throw new Error(
        valveAssetComplete
          ? "Asset coverage audit failed."
          : "Asset audit found generated placeholders. Import VPK/CDN assets or pass --allow-generated for non-acceptance development use.",
      );
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
