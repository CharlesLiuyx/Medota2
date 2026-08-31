export const ASSET_PROVIDER_VERSION = "valve-icon-db-v2";
export const ASSET_LOD_POLICY_VERSION = "icon-webp-64-128-256-v1";
export const ASSET_IMPORT_LOCK_KEYS = [1296389185, 1751740002] as const;

export const ASSET_LODS = [
  { key: "w64", targetWidth: 64, quality: 72 },
  { key: "w128", targetWidth: 128, quality: 78 },
  { key: "w256", targetWidth: 256, quality: 82 },
] as const;

export type AssetEntityType = "hero" | "ability";
export type AssetLodKey = "original" | (typeof ASSET_LODS)[number]["key"];
export type AssetResolutionKind = "exact" | "alias" | "generated_fallback";
export type AssetSourceStatus = "available" | "fallback" | "mismatch" | "error";

export interface PreparedAssetVariant {
  lodKey: AssetLodKey;
  targetWidth: number | null;
  bytes: Buffer;
  contentSha256: string;
  mimeType: string;
  width: number;
  height: number;
  quality: number | null;
}

export interface PreparedEntityAsset {
  entityType: AssetEntityType;
  entityKey: string;
  assetKind: "icon";
  requestedLogicalPath: string;
  resolvedLogicalPath: string;
  resolutionKind: AssetResolutionKind;
  sourceStatus: AssetSourceStatus;
  sourceRepository: string | null;
  sourceCommit: string | null;
  clientVersion: string | null;
  sourceContentSha256: string;
  objectSha256: string;
  providerVersion: string;
  metadata: Record<string, unknown>;
  variants: PreparedAssetVariant[];
}

export interface PreparedAssetDataset {
  assets: PreparedEntityAsset[];
  manifestSha256: string;
  clientVersion: string | null;
  providerVersion: string;
  lodPolicyVersion: string;
  sourceProvenance: {
    dotaconstantsImageMap: {
      sourceRepository: "odota/dotaconstants";
      sourceRemoteUrl: string;
      sourceCommit: string;
      sourceDirty: boolean;
      sourceInputsMatchHead: true;
      manifestSha256: string;
      files: Array<{
        sourcePath: string;
        sha256: string;
        sizeBytes: number;
      }>;
    } | null;
  };
  counts: {
    heroes: number;
    abilities: number;
    exact: number;
    alias: number;
    generatedFallback: number;
    mismatched: number;
    errors: number;
    total: number;
  };
}
