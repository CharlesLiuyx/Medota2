import "server-only";
import { sourceFileRecord } from "@/server/services/source-file-records";
import { getWebDatabase } from "@/server/db/client";
import { getCatalogMeta, type ActiveDatasetMeta } from "./heroes";
import { readPinnedItemSnapshot } from "@/importers/dota-vpk/item-snapshot";
export async function readItemSnapshot(meta: ActiveDatasetMeta) {
  const record = await sourceFileRecord(meta.datasetVersionId, "steam.inf");
  return readPinnedItemSnapshot(meta, record ?? undefined);
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
