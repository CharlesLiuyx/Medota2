import "server-only";
import { getWebDatabase } from "@/server/db/client";
import { getCatalogMeta, type ActiveDatasetMeta } from "./heroes";
import { readPinnedItemSnapshot } from "@/importers/dota-vpk/item-snapshot";
export async function readItemSnapshot(meta: ActiveDatasetMeta) {
  const db = await getWebDatabase();
  const result = await db.query<{ source_commit: string; raw_sha256: string }>(
    `SELECT s.source_commit, f.raw_sha256 FROM source_snapshot_files f JOIN source_snapshots s ON s.id=f.source_snapshot_id JOIN hero_catalog_dataset_versions v ON v.source_snapshot_id=s.id WHERE v.id=$1 AND f.source_path='steam.inf'`,
    [meta.datasetVersionId],
  );
  const record = result.rows[0];
  return readPinnedItemSnapshot(meta, record);
}
export async function getItemOverview(datasetVersionId?: string) {
  const meta = await getCatalogMeta(datasetVersionId);
  const db = meta ? await getWebDatabase() : null;
  const head =
    db && meta
      ? await db.query<{ version: string }>(
          "SELECT dataset_version_id AS version FROM item_asset_heads WHERE catalog_dataset_version_id=$1",
          [meta.datasetVersionId],
        )
      : null;
  return {
    meta,
    snapshot: meta ? await readItemSnapshot(meta) : null,
    imageVersion: head?.rows[0]?.version ?? null,
  };
}
