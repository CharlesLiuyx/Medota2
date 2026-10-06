import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadLocalEnv } from "@/config/env";
import { mapPackageSchema, type MapPackage } from "@/domain/map/schema";
import { parseOverview } from "@/importers/dota-map/adapter";
import { getActiveCatalogMeta } from "@/server/repositories/heroes";
import { getGameplayVersion } from "@/server/services/gameplay-version";
import { getWebDatabase } from "@/server/db/client";
const exec = promisify(execFile);
export const mapSha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export async function readMapPackage(): Promise<{
  map: MapPackage;
  revision: string;
  root: string;
} | null> {
  loadLocalEnv();
  if (!process.env.DOTA_MAP_DATA_PATH) return null;
  const root = resolve(process.env.DOTA_MAP_DATA_PATH);
  const bytes = await readFile(resolve(root, "map.json"));
  const map = mapPackageSchema.parse(JSON.parse(bytes.toString("utf8")));
  return { map, revision: mapSha(bytes), root };
}
export async function readMapImage() {
  const pkg = await readMapPackage();
  if (!pkg) return null;
  const bytes = await readFile(resolve(pkg.root, "overview.webp"));
  if (mapSha(bytes) !== pkg.map.image.sha256)
    throw new Error("Map image checksum mismatch");
  return { bytes, revision: pkg.revision, sha256: pkg.map.image.sha256 };
}
export async function getMapPageData() {
  try {
    const pkg = await readMapPackage();
    if (pkg) {
      const meta = await getActiveCatalogMeta();
      const catalogPatch = meta
        ? await getGameplayVersion(meta.datasetVersionId, meta.sourceCommit)
        : null;
      return {
        provenance: pkg.map.provenance,
        catalogPatch,
        catalogClient: meta?.clientVersion ?? null,
        data: {
          bounds: pkg.map.bounds,
          zones: pkg.map.zones,
          points: pkg.map.points.map((point) => ({
            ...point,
            properties: { targetname: point.properties.targetname ?? "" },
          })),
          imageUrl: `/map/assets/overview.webp?v=${pkg.revision}`,
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
