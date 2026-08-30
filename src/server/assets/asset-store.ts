import type { PoolClient } from "pg";
import type {
  PreparedAssetDataset,
  PreparedAssetVariant,
  PreparedEntityAsset,
} from "@/domain/assets";
import { sha256 } from "@/lib/hash";

export interface PublishedAssetDataset {
  assetDatasetVersionId: string;
  idempotent: boolean;
  promoted: boolean;
}

export interface PublishAssetDatasetOptions {
  allowFallbackDowngrade?: boolean;
  promote?: boolean;
}

export async function publishAssetDataset(
  client: PoolClient,
  catalogDatasetVersionId: string,
  prepared: PreparedAssetDataset,
  options: PublishAssetDatasetOptions = {},
): Promise<PublishedAssetDataset> {
  assertPreparedCoverage(prepared);
  const promote = options.promote !== false;
  if (promote) {
    await assertNoFallbackDowngrade(
      client,
      catalogDatasetVersionId,
      prepared,
      options,
    );
  }
  await persistBlobs(client, prepared.assets);
  await verifyStoredBlobs(client, prepared.assets);
  await persistObjects(client, prepared.assets);

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO asset_dataset_versions
      (catalog_dataset_version_id, manifest_sha256, client_version, provider_version,
       lod_policy_version, source_counts)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (catalog_dataset_version_id, manifest_sha256, provider_version, lod_policy_version)
     DO NOTHING
     RETURNING id`,
    [
      catalogDatasetVersionId,
      prepared.manifestSha256,
      prepared.clientVersion,
      prepared.providerVersion,
      prepared.lodPolicyVersion,
      JSON.stringify(prepared.counts),
    ],
  );
  const existing =
    inserted.rows[0] ??
    (
      await client.query<{ id: string }>(
        `SELECT id FROM asset_dataset_versions
         WHERE catalog_dataset_version_id = $1 AND manifest_sha256 = $2
           AND provider_version = $3 AND lod_policy_version = $4`,
        [
          catalogDatasetVersionId,
          prepared.manifestSha256,
          prepared.providerVersion,
          prepared.lodPolicyVersion,
        ],
      )
    ).rows[0];
  if (!existing)
    throw new Error("Asset dataset identity could not be resolved.");

  if (inserted.rowCount) {
    await persistBindings(
      client,
      existing.id,
      prepared.assets,
      await loadObjectIds(client, prepared.assets),
    );
  }
  await validateStoredCoverage(client, existing.id, prepared);
  if (promote) {
    await client.query("SELECT promote_asset_dataset_version($1)", [
      existing.id,
    ]);
  }
  return {
    assetDatasetVersionId: existing.id,
    idempotent: !inserted.rowCount,
    promoted: promote,
  };
}

async function assertNoFallbackDowngrade(
  client: PoolClient,
  catalogDatasetVersionId: string,
  prepared: PreparedAssetDataset,
  options: PublishAssetDatasetOptions,
): Promise<void> {
  if (options.allowFallbackDowngrade) return;
  const current = await client.query<{
    exact: number;
    native: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE binding.resolution_kind = 'exact')::int AS exact,
       count(*) FILTER (
         WHERE binding.resolution_kind IN ('exact', 'alias')
       )::int AS native
     FROM asset_dataset_heads head
     JOIN entity_asset_bindings binding
       ON binding.asset_dataset_version_id = head.asset_dataset_version_id
     WHERE head.catalog_dataset_version_id = $1
     GROUP BY head.asset_dataset_version_id`,
    [catalogDatasetVersionId],
  );
  const previous = current.rows[0];
  if (!previous) return;
  const nextNative = prepared.counts.exact + prepared.counts.alias;
  if (prepared.counts.exact < previous.exact || nextNative < previous.native) {
    throw new Error(
      `Refusing to replace the current asset dataset with lower Valve coverage ` +
        `(exact ${previous.exact} -> ${prepared.counts.exact}, ` +
        `native ${previous.native} -> ${nextNative}). ` +
        `Restore the extracted VPK source or pass --allow-fallback-downgrade explicitly.`,
    );
  }
}

function assertPreparedCoverage(prepared: PreparedAssetDataset): void {
  const actualCounts = {
    heroes: prepared.assets.filter((asset) => asset.entityType === "hero")
      .length,
    abilities: prepared.assets.filter((asset) => asset.entityType === "ability")
      .length,
    exact: prepared.assets.filter((asset) => asset.resolutionKind === "exact")
      .length,
    alias: prepared.assets.filter((asset) => asset.resolutionKind === "alias")
      .length,
    generatedFallback: prepared.assets.filter(
      (asset) => asset.resolutionKind === "generated_fallback",
    ).length,
    mismatched: prepared.assets.filter(
      (asset) => asset.sourceStatus === "mismatch",
    ).length,
    errors: prepared.assets.filter((asset) => asset.sourceStatus === "error")
      .length,
    total: prepared.assets.length,
  };
  for (const key of Object.keys(actualCounts) as Array<
    keyof typeof actualCounts
  >) {
    if (prepared.counts[key] !== actualCounts[key]) {
      throw new Error(
        `Prepared asset ${key} count does not match its coverage summary.`,
      );
    }
  }
  const identities = new Set<string>();
  for (const asset of prepared.assets) {
    const identity = `${asset.entityType}\0${asset.entityKey}\0${asset.assetKind}`;
    if (identities.has(identity)) {
      throw new Error(`Duplicate entity asset binding: ${identity}`);
    }
    identities.add(identity);
    if (
      asset.providerVersion !== prepared.providerVersion ||
      asset.objectSha256.length !== 64 ||
      asset.sourceContentSha256.length !== 64
    ) {
      throw new Error(
        `Asset ${asset.entityType}/${asset.entityKey} has inconsistent provider identity.`,
      );
    }
    const lods = new Set(asset.variants.map((variant) => variant.lodKey));
    if (asset.variants.length !== 4 || lods.size !== 4) {
      throw new Error(
        `Asset ${asset.entityType}/${asset.entityKey} must have exactly four unique LoDs.`,
      );
    }
    for (const required of ["original", "w64", "w128", "w256"] as const) {
      if (!lods.has(required)) {
        throw new Error(
          `Asset ${asset.entityType}/${asset.entityKey} is missing ${required}.`,
        );
      }
    }
    const original = asset.variants.find(
      (variant) => variant.lodKey === "original",
    )!;
    if (original.contentSha256 !== asset.sourceContentSha256) {
      throw new Error(
        `Asset ${asset.entityType}/${asset.entityKey} original does not match its source content.`,
      );
    }
    for (const variant of asset.variants) assertVariant(asset, variant);
  }
}

function assertVariant(
  asset: PreparedEntityAsset,
  variant: PreparedAssetVariant,
): void {
  if (!variant.bytes.length || variant.width < 1 || variant.height < 1) {
    throw new Error(
      `Asset ${asset.entityType}/${asset.entityKey}/${variant.lodKey} is not displayable.`,
    );
  }
  if (variant.contentSha256.length !== 64) {
    throw new Error("Prepared asset variant has an invalid SHA-256.");
  }
  if (sha256(variant.bytes) !== variant.contentSha256) {
    throw new Error(
      `Asset ${asset.entityType}/${asset.entityKey}/${variant.lodKey} has bytes that do not match its SHA-256.`,
    );
  }
}

async function persistBlobs(
  client: PoolClient,
  assets: readonly PreparedEntityAsset[],
): Promise<void> {
  const blobs = new Map<string, PreparedAssetVariant>();
  for (const asset of assets) {
    for (const variant of asset.variants) {
      const previous = blobs.get(variant.contentSha256);
      if (
        previous &&
        (previous.mimeType !== variant.mimeType ||
          previous.width !== variant.width ||
          previous.height !== variant.height ||
          !previous.bytes.equals(variant.bytes))
      ) {
        throw new Error(
          `Conflicting metadata for asset blob ${variant.contentSha256}.`,
        );
      }
      blobs.set(variant.contentSha256, variant);
    }
  }
  for (const rows of chunks([...blobs.values()], 100)) {
    const parameters: unknown[] = [];
    const values = rows.map((blob, index) => {
      const offset = index * 6;
      parameters.push(
        blob.contentSha256,
        blob.mimeType,
        blob.width,
        blob.height,
        blob.bytes.byteLength,
        blob.bytes,
      );
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6})`;
    });
    await client.query(
      `INSERT INTO asset_blobs
        (content_sha256, mime_type, width, height, byte_size, content)
       VALUES ${values.join(",")}
       ON CONFLICT (content_sha256) DO NOTHING`,
      parameters,
    );
  }
}

async function verifyStoredBlobs(
  client: PoolClient,
  assets: readonly PreparedEntityAsset[],
): Promise<void> {
  const expected = new Map<string, PreparedAssetVariant>();
  for (const asset of assets) {
    for (const variant of asset.variants) {
      expected.set(variant.contentSha256, variant);
    }
  }
  const verified = new Set<string>();
  for (const hashes of chunks([...expected.keys()], 500)) {
    const result = await client.query<{
      content_sha256: string;
      mime_type: string;
      width: number;
      height: number;
      byte_size: string;
    }>(
      `SELECT content_sha256, mime_type, width, height, byte_size::text
       FROM asset_blobs
       WHERE content_sha256 = ANY($1::text[])`,
      [hashes],
    );
    for (const row of result.rows) {
      const variant = expected.get(row.content_sha256);
      if (
        !variant ||
        row.mime_type !== variant.mimeType ||
        row.width !== variant.width ||
        row.height !== variant.height ||
        Number(row.byte_size) !== variant.bytes.byteLength
      ) {
        throw new Error(
          `Stored asset blob metadata conflicts with ${row.content_sha256}.`,
        );
      }
      verified.add(row.content_sha256);
    }
  }
  if (verified.size !== expected.size) {
    throw new Error("Not all prepared asset blobs were persisted.");
  }
}

async function persistObjects(
  client: PoolClient,
  assets: readonly PreparedEntityAsset[],
): Promise<void> {
  const objects = new Map<string, PreparedEntityAsset>();
  for (const asset of assets) objects.set(asset.objectSha256, asset);
  for (const rows of chunks([...objects.values()], 100)) {
    const parameters: unknown[] = [];
    const values = rows.map((asset, index) => {
      const original = asset.variants.find(
        (variant) => variant.lodKey === "original",
      )!;
      const offset = index * 11;
      parameters.push(
        asset.objectSha256,
        asset.assetKind,
        asset.resolvedLogicalPath,
        asset.resolutionKind,
        asset.sourceRepository,
        asset.sourceCommit,
        asset.clientVersion,
        asset.sourceContentSha256,
        original.contentSha256,
        asset.providerVersion,
        JSON.stringify(asset.metadata),
      );
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11}::jsonb)`;
    });
    await client.query(
      `INSERT INTO asset_objects
        (object_sha256, asset_kind, logical_path, source_type, source_repository,
         source_commit, client_version, source_content_sha256, original_blob_sha256,
         provider_version, metadata)
       VALUES ${values.join(",")}
       ON CONFLICT (object_sha256) DO NOTHING`,
      parameters,
    );
  }
  const objectIds = await loadObjectIds(client, [...objects.values()]);
  const variants = [...objects.values()].flatMap((asset) =>
    asset.variants.map((variant) => ({
      asset,
      variant,
      objectId: objectIds.get(asset.objectSha256)!,
    })),
  );
  for (const rows of chunks(variants, 150)) {
    // transformer_version is constant and intentionally kept outside the prepared bytes.
    const expandedParameters: unknown[] = [];
    const expandedValues = rows.map((row, index) => {
      const offset = index * 6;
      expandedParameters.push(
        row.objectId,
        row.variant.lodKey,
        row.variant.targetWidth,
        row.variant.contentSha256,
        ASSET_TRANSFORMER_VERSION,
        row.variant.quality,
      );
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6})`;
    });
    await client.query(
      `INSERT INTO asset_variants
        (asset_object_id, lod_key, target_width, blob_sha256, transformer_version, quality)
       VALUES ${expandedValues.join(",")}
       ON CONFLICT (asset_object_id, lod_key) DO NOTHING`,
      expandedParameters,
    );
  }
}

const ASSET_TRANSFORMER_VERSION = "sharp-0.35.4/webp-v1";

async function loadObjectIds(
  client: PoolClient,
  assets: readonly PreparedEntityAsset[],
): Promise<Map<string, string>> {
  const hashes = [...new Set(assets.map((asset) => asset.objectSha256))];
  const result = await client.query<{ id: string; object_sha256: string }>(
    "SELECT id, object_sha256 FROM asset_objects WHERE object_sha256 = ANY($1::text[])",
    [hashes],
  );
  const ids = new Map(
    result.rows.map((row) => [row.object_sha256, row.id] as const),
  );
  if (ids.size !== hashes.length) {
    throw new Error("Not all prepared asset objects were persisted.");
  }
  return ids;
}

async function persistBindings(
  client: PoolClient,
  assetDatasetVersionId: string,
  assets: readonly PreparedEntityAsset[],
  objectIds: Map<string, string>,
): Promise<void> {
  for (const rows of chunks(assets, 200)) {
    const parameters: unknown[] = [];
    const values = rows.map((asset, index) => {
      const offset = index * 8;
      parameters.push(
        assetDatasetVersionId,
        asset.entityType,
        asset.entityKey,
        asset.assetKind,
        objectIds.get(asset.objectSha256),
        asset.resolutionKind,
        asset.requestedLogicalPath,
        asset.sourceStatus,
      );
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8})`;
    });
    await client.query(
      `INSERT INTO entity_asset_bindings
        (asset_dataset_version_id, entity_type, entity_key, asset_kind, asset_object_id,
         resolution_kind, requested_logical_path, source_status)
       VALUES ${values.join(",")}`,
      parameters,
    );
  }
}

async function validateStoredCoverage(
  client: PoolClient,
  assetDatasetVersionId: string,
  prepared: PreparedAssetDataset,
): Promise<void> {
  const result = await client.query<{
    heroes: number;
    abilities: number;
    incomplete: number;
  }>(
    `SELECT
       count(*) FILTER (WHERE binding.entity_type = 'hero')::int AS heroes,
       count(*) FILTER (WHERE binding.entity_type = 'ability')::int AS abilities,
       count(*) FILTER (WHERE rendition.lod_count <> 4)::int AS incomplete
     FROM entity_asset_bindings binding
     JOIN LATERAL (
       SELECT count(DISTINCT variant.lod_key)::int AS lod_count
       FROM asset_variants variant
       WHERE variant.asset_object_id = binding.asset_object_id
     ) rendition ON true
     WHERE binding.asset_dataset_version_id = $1`,
    [assetDatasetVersionId],
  );
  const row = result.rows[0];
  if (
    row.heroes !== prepared.counts.heroes ||
    row.abilities !== prepared.counts.abilities ||
    row.incomplete !== 0
  ) {
    throw new Error(
      `Stored asset coverage is incomplete (heroes=${row.heroes}, abilities=${row.abilities}, incomplete=${row.incomplete}).`,
    );
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}
