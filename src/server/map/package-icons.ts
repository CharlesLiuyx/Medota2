import "server-only";
import manifest from "@/data/map/package-icons.v1.json";
import { MAP_ICON_PROVIDER, type MapIconSet } from "@/domain/map/icons";
import { getWebDatabase } from "@/server/db/client";
import type { ActiveDatasetMeta } from "@/server/repositories/heroes";

const byKey = new Map(manifest.assets.map((asset) => [asset.key, asset]));
export function packageIconUrl(key: string) {
  const asset = byKey.get(key);
  return asset ? `/map/icons/${key}?v=${asset.objectSha256}` : null;
}
export function hasNativeMapIcons(meta: ActiveDatasetMeta) {
  return (
    meta.clientVersion === manifest.clientVersion &&
    manifest.catalogs.some(
      (c) =>
        c.id === meta.datasetVersionId && c.sourceCommit === meta.sourceCommit,
    )
  );
}
export function nativeHeroIconUrl(meta: ActiveDatasetMeta, key: string) {
  return hasNativeMapIcons(meta)
    ? packageIconUrl(`minimap_heroicon_${key}`)
    : null;
}
export function mapPackageIcons(
  clientVersion: string | null,
  revision: string,
): MapIconSet | undefined {
  if (
    clientVersion !== manifest.clientVersion ||
    revision !== manifest.mapRevision
  )
    return undefined;
  return {
    bundleVersion: manifest.bundleVersion,
    icons: manifest.assets.map((a) => ({
      key: a.key,
      label: a.label,
      group: a.group as MapIconSet["icons"][number]["group"],
      url: packageIconUrl(a.key)!,
      width: a.width,
      height: a.height,
    })),
    points: manifest.points,
    missing: manifest.missing,
  };
}
export async function readMapPackageIcon(
  key: string,
  hash: string,
  width: number | null,
) {
  if (byKey.get(key)?.objectSha256 !== hash) return null;
  const db = await getWebDatabase();
  const result = await db.query<{
    content: Buffer;
    content_sha256: string;
    mime_type: string;
    logical_path: string;
  }>(
    `SELECT b.content, b.content_sha256, b.mime_type, o.logical_path FROM asset_objects o JOIN asset_variants v ON v.asset_object_id=o.id JOIN asset_blobs b ON b.content_sha256=v.blob_sha256 WHERE o.object_sha256=$1 AND o.provider_version=$2 AND o.metadata->>'map_icon_key'=$3 ORDER BY CASE WHEN $4::int IS NULL THEN CASE WHEN v.lod_key='original' THEN 0 ELSE 1 END WHEN b.width >= $4::int THEN 0 ELSE 1 END, CASE WHEN $4::int IS NOT NULL AND b.width >= $4::int THEN b.width END ASC NULLS LAST, b.width DESC LIMIT 1`,
    [hash, MAP_ICON_PROVIDER, key, width],
  );
  return result.rows[0] ?? null;
}
