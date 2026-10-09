import "server-only";
import { getGameLocalization } from "@/server/services/game-localization";
import { getWebDatabase } from "@/server/db/client";
import { getCatalogMeta, type ActiveDatasetMeta } from "./heroes";
import { readPinnedUnitSnapshot } from "@/importers/dota-vpk/unit-snapshot";
export async function readUnitSnapshot(meta: ActiveDatasetMeta) {
  const db = await getWebDatabase();
  const result = await db.query<{ source_commit: string; raw_sha256: string }>(
    `SELECT s.source_commit, f.raw_sha256 FROM source_snapshot_files f JOIN source_snapshots s ON s.id=f.source_snapshot_id JOIN hero_catalog_dataset_versions v ON v.source_snapshot_id=s.id WHERE v.id=$1 AND f.source_path='steam.inf'`,
    [meta.datasetVersionId],
  );
  const record = result.rows[0];
  return readPinnedUnitSnapshot(meta, record);
}
export async function getUnitOverview(datasetVersionId?: string) {
  const meta = await getCatalogMeta(datasetVersionId);
  return { meta, snapshot: meta ? await readUnitSnapshot(meta) : null };
}
export async function getUnitAbilities(
  meta: ActiveDatasetMeta,
  names: string[],
) {
  if (!names.length) return [];
  const db = await getWebDatabase();
  const result = await db.query<{
    internalName: string;
    zhName: string | null;
    enName: string | null;
  }>(
    `SELECT a.internal_name AS "internalName", zh.display_name AS "zhName", en.display_name AS "enName" FROM abilities a LEFT JOIN ability_localizations zh ON zh.dataset_version_id=a.dataset_version_id AND zh.ability_internal_name=a.internal_name AND zh.locale='zh-CN' LEFT JOIN ability_localizations en ON en.dataset_version_id=a.dataset_version_id AND en.ability_internal_name=a.internal_name AND en.locale='en' WHERE a.dataset_version_id=$1 AND a.internal_name=ANY($2::text[])`,
    [meta.datasetVersionId, names],
  );
  const [zh, en] = await Promise.all([
    getGameLocalization(meta.datasetVersionId, meta.sourceCommit, "zh-CN"),
    getGameLocalization(meta.datasetVersionId, meta.sourceCommit, "en"),
  ]);
  return names.map((name) => {
    const row = result.rows.find((item) => item.internalName === name);
    const token = `dota_tooltip_ability_${name}`.toLowerCase();
    return {
      internalName: name,
      available: Boolean(row),
      zhName: row?.zhName || zh[token] || null,
      enName: row?.enName || en[token] || null,
    };
  });
}

export async function getUnitPortraits(catalogVersion: string) {
  const db = await getWebDatabase();
  const result = await db.query<{
    key: string;
    version: string;
    resolution: "portrait" | "shared_portrait" | "related_icon" | "unavailable";
    relation: string | null;
  }>(
    `SELECT b.unit_key AS key, h.dataset_version_id AS version, b.resolution, b.provenance->>'relation' AS relation FROM unit_asset_heads h JOIN unit_asset_bindings b ON b.dataset_version_id=h.dataset_version_id WHERE h.catalog_dataset_version_id=$1`,
    [catalogVersion],
  );
  return Object.fromEntries(
    result.rows.map(({ key, ...value }) => [key, value]),
  );
}
