import { prepareWorker } from "./worker-utils";
import { readPinnedUnitSnapshot } from "@/importers/dota-vpk/unit-snapshot";
import {
  prepareUnitAssets,
  type PreparedUnitBinding,
} from "@/importers/valve-assets/unit-assets";
import { persistPreparedAssetObjects } from "@/server/assets/asset-store";
import { canonicalJsonSha256 } from "@/lib/hash";

async function main() {
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
    }>(`
      SELECT v.id AS "datasetVersionId", s.source_commit AS "sourceCommit", s.source_repository AS "sourceRepository", s.client_version AS "clientVersion", f.raw_sha256
      FROM dataset_heads h JOIN hero_catalog_dataset_versions v ON v.id=h.catalog_dataset_version_id
      JOIN source_snapshots s ON s.id=v.source_snapshot_id JOIN source_snapshot_files f ON f.source_snapshot_id=s.id AND f.source_path='steam.inf'
      WHERE h.dataset_key='hero_catalog'`);
    if (!meta) throw new Error("No active catalog source.");
    const snapshot = await readPinnedUnitSnapshot(meta, {
      source_commit: meta.sourceCommit,
      raw_sha256: meta.raw_sha256,
    });
    if (!snapshot) throw new Error("Matching pinned unit source is required.");
    const { rows: icons } = await pool.query<{
      key: string;
      objectId: string;
      path: string;
    }>(
      `
      SELECT b.entity_key AS key, b.asset_object_id AS "objectId", o.logical_path AS path
      FROM asset_dataset_heads h JOIN entity_asset_bindings b ON b.asset_dataset_version_id=h.asset_dataset_version_id
      JOIN asset_objects o ON o.id=b.asset_object_id
      WHERE h.catalog_dataset_version_id=$1 AND b.entity_type='ability' AND b.resolution_kind='exact'`,
      [meta.datasetVersionId],
    );
    const index = process.argv.indexOf("--portrait-commit");
    const commit = index < 0 ? undefined : process.argv[index + 1];
    if (index >= 0 && !/^[a-f0-9]{40}$/.test(commit ?? ""))
      throw new Error("--portrait-commit requires a full Git commit.");
    const previousPortraits = new Map<string, PreparedUnitBinding>();
    if (process.argv.includes("--reuse-portraits")) {
      const previous = await pool.query<PreparedUnitBinding>(
        `SELECT b.unit_key AS key, b.resolution, b.asset_object_id AS "objectId", b.provenance
        FROM unit_asset_heads h JOIN unit_asset_dataset_versions v ON v.id=h.dataset_version_id JOIN unit_asset_bindings b ON b.dataset_version_id=v.id
        WHERE h.catalog_dataset_version_id=$1 AND b.resolution IN ('portrait','shared_portrait')
        AND v.provenance->'images'->>'portraitCommit' IS NOT DISTINCT FROM $2`,
        [meta.datasetVersionId, commit ?? null],
      );
      for (const row of previous.rows) previousPortraits.set(row.key, row);
    }
    const prepared = await prepareUnitAssets(
      snapshot.units,
      new Map(icons.map((x) => [x.key, x])),
      commit,
      previousPortraits,
    );
    const manifest = canonicalJsonSha256({
      source: prepared.source,
      units: Object.fromEntries(
        Object.entries(snapshot.provenance).filter(
          ([key]) => key !== "imported_at",
        ),
      ),
      bindings: prepared.bindings.map((b) => ({
        key: b.key,
        resolution: b.resolution,
        object: b.asset?.objectSha256 ?? b.objectId ?? null,
      })),
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(1296389185,1751740003)");
      const objectIds = await persistPreparedAssetObjects(
        client,
        prepared.bindings.flatMap((b) => (b.asset ? [b.asset] : [])),
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO unit_asset_dataset_versions (catalog_dataset_version_id,manifest_sha256,expected_keys,provenance) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
        [
          meta.datasetVersionId,
          manifest,
          prepared.bindings.map((b) => b.key),
          JSON.stringify({
            units: snapshot.provenance,
            images: prepared.source,
          }),
        ],
      );
      const version =
        inserted.rows[0]?.id ??
        (
          await client.query<{ id: string }>(
            "SELECT id FROM unit_asset_dataset_versions WHERE catalog_dataset_version_id=$1 AND manifest_sha256=$2",
            [meta.datasetVersionId, manifest],
          )
        ).rows[0].id;
      if (inserted.rowCount)
        for (const binding of prepared.bindings)
          await client.query(
            `INSERT INTO unit_asset_bindings VALUES ($1,$2,$3,$4,$5::jsonb)`,
            [
              version,
              binding.key,
              binding.asset
                ? objectIds.get(binding.asset.objectSha256)
                : (binding.objectId ?? null),
              binding.resolution,
              JSON.stringify(binding.provenance),
            ],
          );
      await client.query("SELECT promote_unit_asset_dataset($1)", [version]);
      await client.query("COMMIT");
      console.log(
        JSON.stringify(
          {
            datasetVersionId: version,
            catalogVersion: meta.datasetVersionId,
            counts: Object.fromEntries(
              [
                "portrait",
                "shared_portrait",
                "related_icon",
                "unavailable",
              ].map((kind) => [
                kind,
                prepared.bindings.filter((b) => b.resolution === kind).length,
              ]),
            ),
            missing: prepared.bindings
              .filter((b) => b.resolution === "unavailable")
              .map((b) => b.key),
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
