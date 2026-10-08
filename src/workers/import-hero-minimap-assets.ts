import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prepareWorker } from "./worker-utils";
import { requiredArgument } from "./cli-args";
import {
  prepareHeroMinimapAssets,
  HERO_MINIMAP_PROVIDER,
} from "@/importers/valve-assets/hero-minimap-assets";
import { persistPreparedAssetObjects } from "@/server/assets/asset-store";
import { canonicalJsonSha256 } from "@/lib/hash";
async function main() {
  const ids = requiredArgument("catalog-versions").split(",");
  if (
    ids.some((id) => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(id))
  )
    throw new Error(
      "--catalog-versions requires comma-separated Catalog UUIDs.",
    );
  const { pool } = await prepareWorker("import");
  try {
    const catalogs = await pool.query<{ id: string; sourceCommit: string }>(
      `SELECT v.id, s.source_commit AS "sourceCommit" FROM hero_catalog_dataset_versions v JOIN source_snapshots s ON s.id=v.source_snapshot_id WHERE v.id=ANY($1::uuid[]) AND v.gate_status<>'red' AND v.review_status<>'rejected' ORDER BY v.id`,
      [ids],
    );
    if (catalogs.rows.length !== new Set(ids).size)
      throw new Error("All requested Catalogs must be eligible.");
    const heroes = await pool.query<{ key: string }>(
      "SELECT DISTINCT internal_name AS key FROM heroes WHERE dataset_version_id=ANY($1::uuid[]) ORDER BY internal_name",
      [ids],
    );
    const assets = await prepareHeroMinimapAssets(
      heroes.rows.map((h) => h.key),
    );
    const body = {
      schemaVersion: 1,
      providerVersion: HERO_MINIMAP_PROVIDER,
      catalogs: catalogs.rows,
      assets: assets.map((a) => ({
        key: a.entityKey,
        objectSha256: a.objectSha256,
        sourceSha256: a.sourceContentSha256,
        sourcePath: a.resolvedLogicalPath,
        sourceUrl: a.metadata.source_url,
      })),
    };
    const manifest = { ...body, manifestSha256: canonicalJsonSha256(body) };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1296389185,1751740005)");
      await persistPreparedAssetObjects(client, assets);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const path = resolve("src/data/map/hero-minimap-icons.v1.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify(manifest, null, 2) + "\n");
    await rename(`${path}.tmp`, path);
    console.log(
      JSON.stringify(
        {
          manifest: path,
          manifestSha256: manifest.manifestSha256,
          catalogs: catalogs.rows,
          icons: assets.length,
          originalBytes: assets.reduce(
            (n, a) => n + a.variants[0].bytes.length,
            0,
          ),
          existingHeadsUnchanged: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await pool.end();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
