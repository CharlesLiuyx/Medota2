import { prepareCatalogAssets } from "@/importers/valve-assets/catalog-assets";
import { ASSET_IMPORT_LOCK_KEYS } from "@/domain/assets";
import { publishAssetDataset } from "@/server/assets/asset-store";
import { prepareWorker } from "./worker-utils";

async function main(): Promise<void> {
  const { pool } = await prepareWorker("import");
  try {
    const requestedCatalogVersion = optionalArgument("catalog-version");
    if (
      requestedCatalogVersion &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        requestedCatalogVersion,
      )
    ) {
      throw new Error("--catalog-version must be a UUID.");
    }
    const catalog = await pool.query<{
      id: string;
      client_version: string;
      source_commit: string;
    }>(
      `SELECT version.id, snapshot.client_version, snapshot.source_commit
       FROM hero_catalog_dataset_versions version
       JOIN source_snapshots snapshot ON snapshot.id = version.source_snapshot_id
       ${
         requestedCatalogVersion
           ? "WHERE version.id = $1"
           : "JOIN dataset_heads head ON head.catalog_dataset_version_id = version.id WHERE head.dataset_key = 'hero_catalog'"
       }`,
      requestedCatalogVersion ? [requestedCatalogVersion] : [],
    );
    if (!catalog.rowCount) {
      throw new Error(
        requestedCatalogVersion
          ? `Hero Catalog ${requestedCatalogVersion} does not exist.`
          : "No active Hero Catalog exists. Import the catalog first.",
      );
    }
    const active = catalog.rows[0];
    const [heroes, abilities] = await Promise.all([
      pool.query<{ internal_name: string }>(
        "SELECT internal_name FROM heroes WHERE dataset_version_id = $1 ORDER BY hero_id",
        [active.id],
      ),
      pool.query<{
        internal_name: string;
        texture_name: string;
        definition_kind: string;
        is_innate: boolean;
      }>(
        `SELECT internal_name, texture_name, definition_kind, is_innate
         FROM abilities WHERE dataset_version_id = $1 ORDER BY internal_name`,
        [active.id],
      ),
    ]);
    const sourceRoot = optionalArgument("asset-root");
    const assetClientVersion = optionalArgument("client-version");
    const prepared = await prepareCatalogAssets(
      heroes.rows.map((row) => ({ internalName: row.internal_name })),
      abilities.rows.map((row) => ({
        internalName: row.internal_name,
        textureName: row.texture_name,
        definitionKind: row.definition_kind,
        isInnate: row.is_innate,
      })),
      active.client_version,
      {
        sourceRoot: sourceRoot ?? undefined,
        assetClientVersion: assetClientVersion ?? undefined,
        catalogSourceCommit: active.source_commit,
        downloadMissing: process.argv.includes("--download-missing"),
      },
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ...ASSET_IMPORT_LOCK_KEYS,
      ]);
      const result = await publishAssetDataset(client, active.id, prepared, {
        allowFallbackDowngrade: process.argv.includes(
          "--allow-fallback-downgrade",
        ),
        promote: !process.argv.includes("--no-promote"),
      });
      await client.query("COMMIT");
      console.log(
        JSON.stringify(
          {
            catalogDatasetVersionId: active.id,
            assetDatasetVersionId: result.assetDatasetVersionId,
            assetManifestSha256: prepared.manifestSha256,
            clientVersion: prepared.clientVersion,
            counts: prepared.counts,
            idempotent: result.idempotent,
            promoted: result.promoted,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

function optionalArgument(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return null;
  const value = process.argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`--${name} requires a value.`);
  }
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
