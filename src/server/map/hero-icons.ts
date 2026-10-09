import "server-only";
import manifest from "@/data/map/hero-minimap-icons.v1.json";
import { getWebDatabase } from "@/server/db/client";
import type { ActiveDatasetMeta } from "@/server/repositories/heroes";
import { nativeHeroIconUrl } from "./package-icons";
export function heroMinimapUrl(meta: ActiveDatasetMeta, key: string) {
  const native = nativeHeroIconUrl(meta, key);
  if (native) return native;
  if (
    !manifest.catalogs.some(
      (c) =>
        c.id === meta.datasetVersionId && c.sourceCommit === meta.sourceCommit,
    )
  )
    return null;
  const asset = manifest.assets.find((a) => a.key === key);
  return asset ? `/map/hero-icons/${key}?v=${asset.objectSha256}` : null;
}
export async function readHeroMinimapIcon(
  key: string,
  hash: string,
  width: number | null,
) {
  const db = await getWebDatabase();
  const result = await db.query<{
    content: Buffer;
    content_sha256: string;
    mime_type: string;
    logical_path: string;
  }>(
    `SELECT b.content, b.content_sha256, b.mime_type, o.logical_path FROM asset_objects o JOIN asset_variants v ON v.asset_object_id=o.id JOIN asset_blobs b ON b.content_sha256=v.blob_sha256 WHERE o.object_sha256=$1 AND o.provider_version='hero-minimap-icons-v1' AND o.metadata->>'hero_key'=$2 ORDER BY CASE WHEN $3::int IS NULL THEN CASE WHEN v.lod_key='original' THEN 0 ELSE 1 END WHEN b.width >= $3::int THEN 0 ELSE 1 END, CASE WHEN $3::int IS NOT NULL AND b.width >= $3::int THEN b.width END ASC NULLS LAST, b.width DESC LIMIT 1`,
    [hash, key, width],
  );
  return result.rows[0] ?? null;
}
