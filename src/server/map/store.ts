import "server-only";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readRoutingData } from "./navigation";
import { loadLocalEnv } from "@/config/env";
import { parseOverview } from "@/importers/dota-map/adapter";
import { getActiveCatalogMeta } from "@/server/repositories/heroes";
import { getGameplayVersion } from "@/server/services/gameplay-version";
import { getWebDatabase } from "@/server/db/client";
import { loadMapAsset, loadMapPackage, readCollection } from "./packages";
const exec = promisify(execFile);
export const mapSha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export async function readMapPackage(id?: string) {
  loadLocalEnv();
  return loadMapPackage(
    process.env.DOTA_MAP_COLLECTION_PATH,
    process.env.DOTA_MAP_DATA_PATH,
    id,
  );
}
export async function readMapImage(
  id?: string,
  name = "overview.webp",
  revision: string | null = null,
) {
  loadLocalEnv();
  return loadMapAsset(
    process.env.DOTA_MAP_COLLECTION_PATH,
    process.env.DOTA_MAP_DATA_PATH,
    id,
    name,
    revision,
  );
}
export async function getMapVersions() {
  loadLocalEnv();
  if (!process.env.DOTA_MAP_COLLECTION_PATH) return null;
  const collection = await readCollection(process.env.DOTA_MAP_COLLECTION_PATH);
  return {
    defaultVersion: collection.defaultVersion,
    versions: collection.versions.map(({ id, patch, clientVersion }) => ({
      id,
      patch,
      clientVersion,
    })),
  };
}
export async function getMapPageData(id?: string) {
  try {
    const pkg = await readMapPackage(id);
    if (pkg) {
      const { watcherRules, visions, ...routing } = await readRoutingData(
        pkg.root,
        pkg.map,
      );
      const meta = await getActiveCatalogMeta().catch(() => null);
      const catalogPatch = meta
        ? await getGameplayVersion(
            meta.datasetVersionId,
            meta.sourceCommit,
          ).catch(() => null)
        : null;
      const assetUrl = (name: string) =>
        `/map/assets/${name}?v=${pkg.revision}${pkg.id ? `&version=${encodeURIComponent(pkg.id)}` : ""}`;
      return {
        revision: pkg.revision,
        id: pkg.id,
        image: pkg.map.image,
        provenance: pkg.map.provenance,
        catalogPatch,
        catalogClient: meta?.clientVersion ?? null,
        data: {
          routing,
          watcherRules,
          visions,
          bounds: pkg.map.bounds,
          zones: pkg.map.zones,
          economy: pkg.map.economy,
          lanePaths: pkg.map.lanePaths,
          points: pkg.map.points.map((point) => ({
            ...point,
            properties: {
              targetname: point.properties.targetname ?? "",
              volumename:
                point.properties.volumename ??
                point.properties.triggerName ??
                "",
            },
          })),
          imageUrl: assetUrl("overview.webp"),
          rasterLayers: pkg.map.rasterLayers.map((layer) => ({
            ...layer,
            url: assetUrl(layer.file),
          })),
          clientVersion: pkg.map.provenance.client_version,
          coverage: pkg.map.coverage,
        },
        error: null,
      };
    }
  } catch (error) {
    console.error(
      "Map package rejected",
      error instanceof Error ? error.message : "Invalid package",
    );
    return { data: null, error: "地图资料校验失败，请重新导入完整资源。" };
  }
  if (id || process.env.DOTA_MAP_COLLECTION_PATH)
    return { data: null, error: "所选地图版本未收录，请选择已收录的版本。" };
  // Only read the immutable overview matching the selected catalog's steam.inf.
  const meta = await getActiveCatalogMeta();
  if (!meta || !/^[a-f0-9]{40}$/.test(meta.sourceCommit))
    return { data: null, error: null };
  const db = await getWebDatabase();
  const result = await db.query<{ raw_sha256: string; source_commit: string }>(
    `SELECT f.raw_sha256, s.source_commit FROM source_snapshot_files f JOIN source_snapshots s ON s.id=f.source_snapshot_id JOIN hero_catalog_dataset_versions v ON v.source_snapshot_id=s.id WHERE v.id=$1 AND f.source_path='steam.inf'`,
    [meta.datasetVersionId],
  );
  const record = result.rows[0];
  if (!record || record.source_commit !== meta.sourceCommit)
    return { data: null, error: null };
  const roots = [
    resolve(
      process.env.DOTA_VPK_WORKTREE_ROOT || ".medota2/cache/worktrees",
      meta.sourceCommit,
    ),
    process.env.DOTA_VPK_UPDATES_PATH,
  ].filter((r): r is string => Boolean(r));
  for (const root of roots) {
    try {
      const read = async (path: string) =>
        (
          await exec(
            "git",
            ["-C", root, "show", `${meta.sourceCommit}:${path}`],
            { timeout: 5000, maxBuffer: 1024 * 1024 },
          )
        ).stdout;
      if (mapSha(await read("steam.inf")) !== record.raw_sha256) continue;
      const overview = parseOverview(await read("resource/overviews/dota.txt"));
      return {
        data: {
          bounds: overview.bounds,
          points: [],
          imageUrl: null,
          clientVersion: meta.clientVersion,
          coverage: null,
        },
        error: null,
      };
    } catch {
      continue;
    }
  }
  return { data: null, error: null };
}
