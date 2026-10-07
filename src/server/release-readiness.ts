import { previewEnvironment } from "@/development/preview";
import { loadLocalEnv } from "@/config/env";
import { readPinnedGameplayVersion } from "@/importers/dota-vpk/gameplay-version";
import { readPinnedItemSnapshot } from "@/importers/dota-vpk/item-snapshot";
import { readPinnedUnitSnapshot } from "@/importers/dota-vpk/unit-snapshot";
import {
  readCollection,
  loadMapPackage,
  loadMapAsset,
} from "@/server/map/packages";
import { readRoutingData } from "@/server/map/navigation";
import type { VerifiedReadSnapshot } from "@/server/environment/contract";

export async function inspectReleaseReadiness(
  db: Pick<VerifiedReadSnapshot, "query">,
  catalogId: string,
) {
  loadLocalEnv();
  const {
    rows: [meta],
  } = await db.query<{
    datasetVersionId: string;
    sourceCommit: string;
    sourceRepository: string;
    clientVersion: string;
    steamSha256: string;
    source_counts: {
      heroes: { accepted: number };
      abilities: { accepted: number; facets: number; bindings: number };
    };
    heroes: number;
    abilities: number;
    facets: number;
    bindings: number;
    localizations: number;
    assets: number;
    unitKeys: string[] | null;
    itemKeys: string[] | null;
  }>(
    `SELECT v.id AS "datasetVersionId", s.source_commit AS "sourceCommit", s.source_repository AS "sourceRepository", s.client_version AS "clientVersion", f.raw_sha256 AS "steamSha256", v.source_counts,
    (SELECT count(*)::int FROM heroes WHERE dataset_version_id=v.id) AS heroes,
    (SELECT count(*)::int FROM abilities WHERE dataset_version_id=v.id) AS abilities,
    (SELECT count(*)::int FROM facets WHERE dataset_version_id=v.id) AS facets,
    (SELECT count(*)::int FROM hero_ability_bindings WHERE dataset_version_id=v.id) AS bindings,
    (SELECT count(*)::int FROM hero_localizations WHERE dataset_version_id=v.id)+(SELECT count(*)::int FROM ability_localizations WHERE dataset_version_id=v.id) AS localizations,
    (SELECT count(*)::int FROM asset_dataset_heads h JOIN entity_asset_bindings b ON b.asset_dataset_version_id=h.asset_dataset_version_id WHERE h.catalog_dataset_version_id=v.id) AS assets,
    (SELECT array_agg(b.unit_key ORDER BY b.unit_key) FROM unit_asset_heads h JOIN unit_asset_bindings b ON b.dataset_version_id=h.dataset_version_id WHERE h.catalog_dataset_version_id=v.id) AS "unitKeys",
    (SELECT array_agg(b.item_key ORDER BY b.item_key) FROM item_asset_heads h JOIN item_asset_bindings b ON b.dataset_version_id=h.dataset_version_id WHERE h.catalog_dataset_version_id=v.id) AS "itemKeys"
    FROM hero_catalog_dataset_versions v JOIN source_snapshots s ON s.id=v.source_snapshot_id
    JOIN source_snapshot_files f ON f.source_snapshot_id=s.id AND f.source_path='steam.inf'
    WHERE v.id=$1 AND v.gate_status<>'red' AND v.review_status<>'rejected'`,
    [catalogId],
  );
  const problems: string[] = [];
  if (!meta)
    return {
      ready: false,
      patch: null,
      catalogId,
      mapId: null,
      problems: ["缺少有效Catalog与固定来源。"],
    };
  const expected = meta.source_counts;
  if (
    !expected?.heroes ||
    !expected.abilities ||
    meta.heroes < 1 ||
    meta.abilities < 1 ||
    meta.heroes !== expected.heroes.accepted ||
    meta.abilities !== expected.abilities.accepted ||
    meta.facets !== expected.abilities.facets ||
    meta.bindings !== expected.abilities.bindings ||
    meta.localizations !== 2 * (meta.heroes + meta.abilities)
  )
    problems.push("英雄、技能、命石、关系或本地化未完整收录。");
  if (meta.assets !== meta.heroes + meta.abilities)
    problems.push("英雄／技能图片绑定未完整准备。");
  const patch = await readPinnedGameplayVersion(
    meta.sourceCommit,
    meta.steamSha256,
  );
  if (!patch) problems.push("缺少已核验的游戏补丁声明。");
  const units = await readPinnedUnitSnapshot(meta, {
    source_commit: meta.sourceCommit,
    raw_sha256: meta.steamSha256,
  });
  if (!units?.units.length) problems.push("缺少同来源提交的单位定义。");
  else if (
    JSON.stringify(units.units.map((unit) => unit.internalName).sort()) !==
    JSON.stringify(meta.unitKeys)
  )
    problems.push("单位图片状态未覆盖完整单位身份集合。");
  const items = await readPinnedItemSnapshot(meta, {
    source_commit: meta.sourceCommit,
    raw_sha256: meta.steamSha256,
  });
  if (!items?.items.length) problems.push("缺少同来源提交的物品定义。");
  else if (
    JSON.stringify(items.items.map((item) => item.internalName).sort()) !==
    JSON.stringify(meta.itemKeys)
  )
    problems.push("物品图片未覆盖完整物品身份集合。");
  const environment = process.env.MEDOTA2_ENVIRONMENT;
  const collectionPath =
    environment === "development" || environment === "local-review"
      ? previewEnvironment(environment).DOTA_MAP_COLLECTION_PATH
      : process.env.DOTA_MAP_COLLECTION_PATH;
  const maps = collectionPath ? await readCollection(collectionPath) : null;
  const matching = maps?.versions.filter((map) => map.patch === patch) ?? [];
  const mapId = matching.length === 1 ? matching[0].id : null;
  if (!mapId)
    problems.push("缺少同补丁唯一地图资料；先准备完整地图后再收录版本。");
  else {
    const pkg = await loadMapPackage(collectionPath, undefined, mapId);
    if (!pkg?.map.points.length) problems.push("地图对象未完整接入。");
    else {
      if (
        pkg.map.provenance.client_version &&
        pkg.map.provenance.client_version !== meta.clientVersion
      )
        problems.push("地图与Catalog的已知客户端构建号不一致。");
      for (const name of [
        pkg.map.image.file,
        ...pkg.map.rasterLayers.map((layer) => layer.file),
      ]) {
        if (
          !(await loadMapAsset(
            collectionPath,
            undefined,
            mapId,
            name,
            pkg.revision,
          ))
        )
          problems.push(`地图资源不可用：${name}`);
      }
      await readRoutingData(pkg.root, pkg.map);
    }
  }
  return {
    ready: problems.length === 0,
    patch,
    catalogId,
    mapId,
    counts: {
      heroes: meta.heroes,
      abilities: meta.abilities,
      facets: meta.facets,
      units: units?.units.length ?? 0,
      items: items?.items.length ?? 0,
    },
    problems,
  };
}
export async function assertReleaseReady(
  db: Pick<VerifiedReadSnapshot, "query">,
  catalogId: string,
) {
  const result = await inspectReleaseReadiness(db, catalogId);
  if (!result.ready)
    throw new Error(`完整版本尚未就绪：${result.problems.join(" ")}`);
  return result;
}
