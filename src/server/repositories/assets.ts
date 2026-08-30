import "server-only";

import { getWebPool } from "@/server/db/client";
import { assertSchemaCurrent } from "@/server/db/migrations";

export type AssetEntityType = "hero" | "ability";

export interface ActiveAssetVariant {
  content: Buffer;
  contentSha256: string;
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
  lodKey: string;
  targetWidth: number | null;
  sourceType: string;
  logicalPath: string;
}

interface ActiveAssetVariantRow {
  content: Buffer;
  content_sha256: string;
  mime_type: string;
  width: number;
  height: number;
  byte_size: string;
  lod_key: string;
  target_width: number | null;
  source_type: string;
  logical_path: string;
}

let schemaPromise: Promise<string> | undefined;

async function ensureReady(): Promise<void> {
  schemaPromise ??= assertSchemaCurrent(getWebPool());
  await schemaPromise;
}

export async function getActiveEntityIcon(
  entityType: AssetEntityType,
  entityKey: string,
  requestedWidth: number | null,
  assetDatasetVersionId?: string,
): Promise<ActiveAssetVariant | null> {
  await ensureReady();
  const result = await getWebPool().query<ActiveAssetVariantRow>(
    `SELECT b.content, b.content_sha256, b.mime_type, b.width, b.height,
       b.byte_size::text, v.lod_key, v.target_width, o.source_type, o.logical_path
     FROM entity_asset_bindings binding
     JOIN asset_objects o ON o.id = binding.asset_object_id
     JOIN asset_variants v ON v.asset_object_id = o.id
     JOIN asset_blobs b ON b.content_sha256 = v.blob_sha256
     WHERE binding.entity_type = $1
       AND binding.entity_key = $2
       AND binding.asset_kind = 'icon'
       AND ${
         assetDatasetVersionId
           ? "binding.asset_dataset_version_id = $4::uuid"
           : `binding.asset_dataset_version_id = (
               SELECT asset_head.asset_dataset_version_id
               FROM dataset_heads catalog_head
               JOIN asset_dataset_heads asset_head
                 ON asset_head.catalog_dataset_version_id = catalog_head.catalog_dataset_version_id
               WHERE catalog_head.dataset_key = 'hero_catalog'
             )`
       }
     ORDER BY
       CASE
         WHEN $3::integer IS NULL THEN CASE WHEN v.lod_key = 'original' THEN 0 ELSE 1 END
         WHEN v.lod_key <> 'original' AND b.width >= $3::integer THEN 0
         ELSE 1
       END,
       CASE
         WHEN $3::integer IS NOT NULL
           AND v.lod_key <> 'original'
           AND b.width >= $3::integer
         THEN b.width
       END ASC NULLS LAST,
       CASE WHEN $3::integer IS NOT NULL THEN b.width END DESC NULLS LAST,
       CASE
         WHEN $3::integer IS NOT NULL AND v.lod_key = 'original' THEN 1
         ELSE 0
       END,
       CASE WHEN v.lod_key <> 'original' THEN v.target_width END ASC NULLS LAST,
       v.lod_key
     LIMIT 1`,
    assetDatasetVersionId
      ? [entityType, entityKey, requestedWidth, assetDatasetVersionId]
      : [entityType, entityKey, requestedWidth],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    content: row.content,
    contentSha256: row.content_sha256,
    mimeType: row.mime_type,
    width: row.width,
    height: row.height,
    byteSize: Number(row.byte_size),
    lodKey: row.lod_key,
    targetWidth: row.target_width,
    sourceType: row.source_type,
    logicalPath: row.logical_path,
  };
}
