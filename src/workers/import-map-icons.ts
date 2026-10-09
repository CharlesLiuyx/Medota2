import { writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { prepareWorker } from "./worker-utils";
import { requiredArgument } from "./cli-args";
import { prepareMapPackageAssets } from "@/importers/valve-assets/map-package-assets";
import { persistPreparedAssetObjects } from "@/server/assets/asset-store";
import { canonicalJsonSha256 } from "@/lib/hash";
import { attachMissingUnitMapIcons } from "@/server/assets/map-unit-bindings";

async function main() {
  const prepared = await prepareMapPackageAssets(
    resolve(requiredArgument("package")),
  );
  const { pool } = await prepareWorker("import");
  try {
    const catalogs = await pool.query<{ id: string; sourceCommit: string }>(
      `SELECT v.id, s.source_commit AS "sourceCommit" FROM hero_catalog_dataset_versions v JOIN source_snapshots s ON s.id=v.source_snapshot_id JOIN unit_asset_heads uh ON uh.catalog_dataset_version_id=v.id JOIN unit_asset_dataset_versions uv ON uv.id=uh.dataset_version_id WHERE s.client_version=$1 AND s.source_commit=$2 AND uv.provenance->'units'->>'source_commit'=s.source_commit AND EXISTS (SELECT 1 FROM jsonb_array_elements(uv.provenance->'units'->'files') f WHERE f->>'source_path'='scripts/npc/npc_units.txt' AND f->>'raw_sha256'=$3) AND v.gate_status<>'red' AND v.review_status<>'rejected' ORDER BY v.id`,
      [
        prepared.body.clientVersion,
        prepared.body.sourceCommit,
        prepared.body.unitSourceSha256,
      ],
    );
    if (!catalogs.rows.length)
      throw new Error("Matching eligible 6944 Catalog required.");
    const heroes = await pool.query<{ key: string }>(
      "SELECT DISTINCT internal_name AS key FROM heroes WHERE dataset_version_id=ANY($1::uuid[])",
      [catalogs.rows.map((c) => c.id)],
    );
    for (const hero of heroes.rows)
      if (
        !prepared.body.assets.some(
          (a) => a.key === `minimap_heroicon_${hero.key}`,
        )
      )
        throw new Error(`Missing hero minimap icon: ${hero.key}`);
    const body = { ...prepared.body, catalogs: catalogs.rows };
    const manifest = { ...body, manifestSha256: canonicalJsonSha256(body) };
    const client = await pool.connect();
    const units = [];
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1296389185,1751740005)");
      const objectIds = await persistPreparedAssetObjects(
        client,
        prepared.assets,
      );
      const unitIcons = Object.fromEntries(
        Object.entries(body.unitIcons).map(([unit, key]) => {
          const asset = body.assets.find((a) => a.key === key)!;
          return [
            unit,
            {
              key,
              objectId: objectIds.get(asset.objectSha256)!,
              sourceSha256: asset.sourceSha256,
            },
          ];
        }),
      );
      for (const catalog of catalogs.rows)
        units.push(
          await attachMissingUnitMapIcons(
            client,
            catalog.id,
            unitIcons,
            body.bundleManifestSha256,
          ),
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const path = resolve("src/data/map/package-icons.v1.json");
    await writeFile(`${path}.tmp`, JSON.stringify(manifest, null, 2) + "\n");
    await rename(`${path}.tmp`, path);
    console.log(
      JSON.stringify(
        {
          icons: prepared.assets.length,
          heroes: heroes.rows.length,
          points: Object.keys(body.points).length,
          missing: body.missing,
          verifiedFiles: body.verifiedFiles,
          manifestSha256: manifest.manifestSha256,
          catalogs: body.catalogs,
          units,
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
