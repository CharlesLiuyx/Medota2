import { requiredArgument } from "./cli-args";
import { prepareWorker } from "./worker-utils";
import { readPinnedItemSnapshot } from "@/importers/dota-vpk/item-snapshot";
import { prepareItemAssets } from "@/importers/valve-assets/item-assets";
import { persistPreparedAssetObjects } from "@/server/assets/asset-store";
import { canonicalJsonSha256 } from "@/lib/hash";

async function main() {
  const catalogVersion = process.argv.includes("--catalog-version")
    ? requiredArgument("catalog-version")
    : null;
  if (
    catalogVersion &&
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(catalogVersion)
  ) {
    throw new Error("--catalog-version requires a Catalog UUID.");
  }
  const { pool } = await prepareWorker("import");
  try {
    const {
      rows: [meta],
    } = await pool.query<{
      datasetVersionId: string;
      sourceCommit: string;
      sourceRepository: string;
      clientVersion: string;
      raw_sha256: string;
    }>(
      `
      SELECT v.id AS "datasetVersionId", s.source_commit AS "sourceCommit", s.source_repository AS "sourceRepository", s.client_version AS "clientVersion", f.raw_sha256
      FROM hero_catalog_dataset_versions v
      JOIN source_snapshots s ON s.id=v.source_snapshot_id JOIN source_snapshot_files f ON f.source_snapshot_id=s.id AND f.source_path='steam.inf'
      WHERE v.id=COALESCE($1::uuid,(SELECT catalog_dataset_version_id FROM dataset_heads WHERE dataset_key='hero_catalog'))
        AND v.gate_status<>'red' AND v.review_status<>'rejected'`,
      [catalogVersion],
    );
    if (!meta) throw new Error("No eligible catalog source.");
    const snapshot = await readPinnedItemSnapshot(meta, {
      source_commit: meta.sourceCommit,
      raw_sha256: meta.raw_sha256,
    });
    if (!snapshot) throw new Error("Matching pinned item source is required.");
    const prepared = await prepareItemAssets(snapshot.items);
    const manifest = canonicalJsonSha256({
      source: prepared.source,
      items: Object.fromEntries(
        Object.entries(snapshot.provenance).filter(
          ([key]) => key !== "imported_at",
        ),
      ),
      bindings: prepared.bindings.map((b) => ({
        key: b.key,
        resolution: b.resolution,
        object: b.asset.objectSha256,
      })),
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1296389185,1751740004)");
      const objectIds = await persistPreparedAssetObjects(
        client,
        prepared.bindings.flatMap((b) => (b.asset ? [b.asset] : [])),
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO item_asset_dataset_versions (catalog_dataset_version_id,manifest_sha256,expected_keys,provenance) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
        [
          meta.datasetVersionId,
          manifest,
          prepared.bindings.map((b) => b.key),
          JSON.stringify({
            items: snapshot.provenance,
            images: prepared.source,
          }),
        ],
      );
      const version =
        inserted.rows[0]?.id ??
        (
          await client.query<{ id: string }>(
            "SELECT id FROM item_asset_dataset_versions WHERE catalog_dataset_version_id=$1 AND manifest_sha256=$2",
            [meta.datasetVersionId, manifest],
          )
        ).rows[0].id;
      if (inserted.rowCount)
        for (const binding of prepared.bindings)
          await client.query(
            `INSERT INTO item_asset_bindings VALUES ($1,$2,$3,$4,$5::jsonb)`,
            [
              version,
              binding.key,
              objectIds.get(binding.asset.objectSha256),
              binding.resolution,
              JSON.stringify(binding.provenance),
            ],
          );
      await client.query("SELECT promote_item_asset_dataset($1)", [version]);
      await client.query("COMMIT");
      console.log(
        JSON.stringify(
          {
            datasetVersionId: version,
            catalogVersion: meta.datasetVersionId,
            counts: Object.fromEntries(
              ["icon", "shared_icon"].map((kind) => [
                kind,
                prepared.bindings.filter((b) => b.resolution === kind).length,
              ]),
            ),
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
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
