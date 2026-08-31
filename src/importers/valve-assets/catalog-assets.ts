import { realpath, readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import sharp from "sharp";
import {
  getOptionalPath,
  getOptionalValue,
  getRequiredPath,
} from "@/config/env";
import {
  ASSET_LODS,
  ASSET_LOD_POLICY_VERSION,
  ASSET_PROVIDER_VERSION,
  type AssetResolutionKind,
  type AssetSourceStatus,
  type PreparedAssetDataset,
  type PreparedAssetVariant,
  type PreparedEntityAsset,
} from "@/domain/assets";
import {
  readValveAssetExtractionManifest,
  type ValveAssetExtractionManifest,
} from "@/importers/valve-assets/extraction-manifest";
import {
  derivedSteamAbilityPath,
  derivedSteamHeroPath,
  loadDotaconstantsSteamImageMap,
  readSteamStaticSource,
  STEAM_STATIC_SOURCE,
  steamAliasPath,
  type SteamStaticFetcher,
  type SteamStaticImageMap,
} from "@/importers/valve-assets/steam-static-assets";
import { canonicalJsonSha256, sha256 } from "@/lib/hash";

const VALVE_CLIENT_SOURCE = "Valve Dota 2 client VPK";
const FALLBACK_SOURCE = "Medota2 generated icon";
const MAX_INPUT_PIXELS = 16_777_216;
const EMPTY_STEAM_IMAGE_MAP: SteamStaticImageMap = {
  heroes: new Map(),
  abilities: new Map(),
  provenance: {
    sourceRepository: "odota/dotaconstants",
    sourceRemoteUrl: "",
    sourceCommit: "",
    sourceDirty: false,
    sourceInputsMatchHead: true,
    manifestSha256: "",
    files: [],
  },
};

interface AssetJob {
  entityType: "hero" | "ability";
  entityKey: string;
  requestedLogicalPath: string;
  aliases: string[];
  steamExactPaths: string[];
  steamAliasPaths: string[];
  fallbackLabel: string;
}

interface ResolvedSource {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
  logicalPath: string;
  sourceRepository: string;
  sourceUrl: string | null;
  sourceKind: "vpk" | "steam_cdn" | "generated";
}

export interface PrepareCatalogAssetOptions {
  sourceRoot?: string | null;
  assetClientVersion?: string | null;
  /** Catalog provenance is represented by the asset dataset's catalog FK. */
  catalogSourceCommit?: string | null;
  downloadMissing?: boolean;
  dotaconstantsRoot?: string | null;
  steamFetcher?: SteamStaticFetcher;
}

export interface CatalogAssetHero {
  internalName: string;
}

export interface CatalogAssetAbility {
  internalName: string;
  textureName: string;
  definitionKind: string;
  isInnate: boolean;
}

export async function prepareCatalogAssets(
  heroes: readonly CatalogAssetHero[],
  abilities: readonly CatalogAssetAbility[],
  catalogClientVersion: string,
  options: PrepareCatalogAssetOptions = {},
): Promise<PreparedAssetDataset> {
  const configuredRoot =
    options.sourceRoot === undefined
      ? getOptionalPath("DOTA_VALVE_ASSET_PATH")
      : options.sourceRoot;
  const declaredAssetClientVersion =
    options.assetClientVersion === undefined
      ? getOptionalValue("DOTA_VALVE_ASSET_CLIENT_VERSION")
      : options.assetClientVersion;
  let root: string | null = null;
  let extractionManifest: ValveAssetExtractionManifest | null = null;
  let mismatch = false;
  if (configuredRoot) {
    const resolvedRoot = await validDirectory(configuredRoot);
    if (!resolvedRoot) {
      throw new Error(
        `Configured Valve asset directory is not readable: ${configuredRoot}`,
      );
    }
    extractionManifest = await readValveAssetExtractionManifest(resolvedRoot);
    mismatch =
      extractionManifest.clientVersion !== catalogClientVersion ||
      Boolean(
        declaredAssetClientVersion &&
        declaredAssetClientVersion !== extractionManifest.clientVersion,
      );
    root = mismatch ? null : resolvedRoot;
  }
  const assetClientVersion =
    extractionManifest?.clientVersion ?? catalogClientVersion;
  const downloadMissing = options.downloadMissing === true;
  const steamImageMap = downloadMissing
    ? await loadDotaconstantsSteamImageMap(
        options.dotaconstantsRoot ?? getRequiredPath("DOTACONSTANTS_PATH"),
      )
    : EMPTY_STEAM_IMAGE_MAP;
  const jobs = catalogAssetJobs(heroes, abilities, steamImageMap);
  const readCache = new Map<string, Promise<ResolvedSource | null>>();
  const steamCache = new Map<string, Promise<ResolvedSource | null>>();
  const variantCache = new Map<string, Promise<PreparedAssetVariant[]>>();

  const assets = await mapConcurrent(jobs, 6, async (job) => {
    let sourceFailed = false;
    const context = {
      clientVersion: assetClientVersion,
      extractionManifest,
    };

    if (root) {
      try {
        const source = await readCachedSource(
          root,
          job.requestedLogicalPath,
          readCache,
        );
        if (source) {
          return await prepareEntityAsset(
            job,
            source,
            {
              ...context,
              resolutionKind: "exact",
              sourceStatus: "available",
            },
            variantCache,
          );
        }
      } catch {
        sourceFailed = true;
      }
    }

    if (downloadMissing) {
      for (const path of job.steamExactPaths) {
        try {
          const source = await readCachedSteamSource(
            path,
            steamCache,
            options.steamFetcher,
          );
          if (source) {
            return await prepareEntityAsset(
              job,
              source,
              {
                clientVersion: assetClientVersion,
                extractionManifest: null,
                resolutionKind: "exact",
                sourceStatus: "available",
              },
              variantCache,
            );
          }
        } catch {
          sourceFailed = true;
        }
      }
    }

    if (root) {
      for (const alias of job.aliases) {
        try {
          const source = await readCachedSource(root, alias, readCache);
          if (source) {
            return await prepareEntityAsset(
              job,
              source,
              {
                ...context,
                resolutionKind: "alias",
                sourceStatus: sourceFailed ? "error" : "fallback",
              },
              variantCache,
            );
          }
        } catch {
          sourceFailed = true;
        }
      }
    }

    if (downloadMissing) {
      for (const path of job.steamAliasPaths) {
        try {
          const source = await readCachedSteamSource(
            path,
            steamCache,
            options.steamFetcher,
          );
          if (source) {
            return await prepareEntityAsset(
              job,
              source,
              {
                clientVersion: assetClientVersion,
                extractionManifest: null,
                resolutionKind: "alias",
                sourceStatus: sourceFailed ? "error" : "fallback",
              },
              variantCache,
            );
          }
        } catch {
          sourceFailed = true;
        }
      }
    }

    const fallback = await generatedFallback(job);
    return prepareEntityAsset(
      job,
      fallback,
      {
        clientVersion: assetClientVersion,
        extractionManifest: null,
        resolutionKind: "generated_fallback",
        sourceStatus: mismatch
          ? "mismatch"
          : sourceFailed
            ? "error"
            : "fallback",
      },
      variantCache,
    );
  });

  assets.sort((left, right) =>
    Buffer.from(`${left.entityType}\0${left.entityKey}`).compare(
      Buffer.from(`${right.entityType}\0${right.entityKey}`),
    ),
  );
  const counts = {
    heroes: heroes.length,
    abilities: abilities.length,
    exact: assets.filter((asset) => asset.resolutionKind === "exact").length,
    alias: assets.filter((asset) => asset.resolutionKind === "alias").length,
    generatedFallback: assets.filter(
      (asset) => asset.resolutionKind === "generated_fallback",
    ).length,
    mismatched: assets.filter((asset) => asset.sourceStatus === "mismatch")
      .length,
    errors: assets.filter((asset) => asset.sourceStatus === "error").length,
    total: assets.length,
  };
  const sourceProvenance = {
    dotaconstantsImageMap: downloadMissing ? steamImageMap.provenance : null,
  };
  const manifestSha256 = canonicalJsonSha256({
    sourceProvenance,
    assets: assets.map((asset) => ({
      entityType: asset.entityType,
      entityKey: asset.entityKey,
      assetKind: asset.assetKind,
      requestedLogicalPath: asset.requestedLogicalPath,
      resolvedLogicalPath: asset.resolvedLogicalPath,
      resolutionKind: asset.resolutionKind,
      sourceStatus: asset.sourceStatus,
      objectSha256: asset.objectSha256,
      variants: asset.variants.map((variant) => ({
        lodKey: variant.lodKey,
        contentSha256: variant.contentSha256,
      })),
    })),
  });

  return {
    assets,
    manifestSha256,
    clientVersion: assetClientVersion ?? catalogClientVersion,
    providerVersion: ASSET_PROVIDER_VERSION,
    lodPolicyVersion: ASSET_LOD_POLICY_VERSION,
    sourceProvenance,
    counts,
  };
}

export function catalogAssetJobs(
  heroes: readonly CatalogAssetHero[],
  abilities: readonly CatalogAssetAbility[],
  steamImageMap: SteamStaticImageMap = EMPTY_STEAM_IMAGE_MAP,
): AssetJob[] {
  return [
    ...heroes.map((hero) => ({
      entityType: "hero" as const,
      entityKey: hero.internalName,
      requestedLogicalPath: `panorama/images/heroes/icons/${hero.internalName}_png.vtex_c`,
      aliases: [
        "panorama/images/heroes/icons/npc_dota_hero_default_png.vtex_c",
        "panorama/images/heroes/npc_dota_hero_default_png.vtex_c",
      ],
      steamExactPaths: uniquePaths([
        steamImageMap.heroes.get(hero.internalName),
        derivedSteamHeroPath(hero.internalName),
      ]),
      steamAliasPaths: [],
      fallbackLabel: initials(
        hero.internalName.replace(/^npc_dota_hero_/u, ""),
      ),
    })),
    ...abilities.map((ability) => {
      const aliases =
        ability.definitionKind === "talent"
          ? ["panorama/images/spellicons/attribute_bonus_png.vtex_c"]
          : ability.isInnate
            ? [
                "panorama/images/hud/facets/innate_icon_large_png.vtex_c",
                "panorama/images/hud/facets/innate_icon_png.vtex_c",
                "panorama/images/spellicons/empty_png.vtex_c",
              ]
            : ["panorama/images/spellicons/empty_png.vtex_c"];
      return {
        entityType: "ability" as const,
        entityKey: ability.internalName,
        requestedLogicalPath: `panorama/images/spellicons/${ability.textureName}_png.vtex_c`,
        aliases,
        steamExactPaths: uniquePaths([
          steamImageMap.abilities.get(ability.internalName),
          derivedSteamAbilityPath(ability.textureName),
        ]),
        steamAliasPaths: uniquePaths(aliases.map(steamAliasPath)),
        fallbackLabel: initials(ability.internalName),
      };
    }),
  ];
}

async function prepareEntityAsset(
  job: AssetJob,
  source: ResolvedSource,
  context: {
    resolutionKind: AssetResolutionKind;
    sourceStatus: AssetSourceStatus;
    clientVersion: string;
    extractionManifest: ValveAssetExtractionManifest | null;
  },
  variantCache: Map<string, Promise<PreparedAssetVariant[]>>,
): Promise<PreparedEntityAsset> {
  const sourceContentSha256 = sha256(source.bytes);
  let pendingVariants = variantCache.get(sourceContentSha256);
  if (!pendingVariants) {
    pendingVariants = buildVariants(source);
    variantCache.set(sourceContentSha256, pendingVariants);
  }
  const variants = await pendingVariants;
  const objectSha256 = canonicalJsonSha256({
    assetKind: "icon",
    sourceContentSha256,
    resolvedLogicalPath: source.logicalPath,
    resolutionKind: context.resolutionKind,
    sourceRepository: source.sourceRepository,
    sourceUrl: source.sourceUrl,
    clientVersion: context.clientVersion,
    providerVersion: ASSET_PROVIDER_VERSION,
    lodPolicyVersion: ASSET_LOD_POLICY_VERSION,
    extraction: extractionContentIdentity(context.extractionManifest),
    variants: variants.map((variant) => ({
      lodKey: variant.lodKey,
      contentSha256: variant.contentSha256,
    })),
  });
  return {
    entityType: job.entityType,
    entityKey: job.entityKey,
    assetKind: "icon",
    requestedLogicalPath: job.requestedLogicalPath,
    resolvedLogicalPath: source.logicalPath,
    resolutionKind: context.resolutionKind,
    sourceStatus: context.sourceStatus,
    sourceRepository: source.sourceRepository,
    sourceCommit: null,
    clientVersion: context.clientVersion,
    sourceContentSha256,
    objectSha256,
    providerVersion: ASSET_PROVIDER_VERSION,
    metadata: {
      originalMimeType: source.mimeType,
      originalWidth: source.width,
      originalHeight: source.height,
      sourceUrl: source.sourceUrl,
      extraction: extractionIdentity(context.extractionManifest),
    },
    variants,
  };
}

function extractionIdentity(
  manifest: ValveAssetExtractionManifest | null,
): Record<string, unknown> | null {
  if (!manifest) return null;
  return {
    schemaVersion: manifest.schemaVersion,
    extractedAt: manifest.extractedAt,
    vpkByteSize: manifest.vpk.byteSize,
    vpkSha256: manifest.vpk.sha256,
    source2ViewerVersion: manifest.source2Viewer.version,
    filters: manifest.source2Viewer.filters,
    extensions: manifest.source2Viewer.extensions,
    textureDecodeFlags: manifest.source2Viewer.textureDecodeFlags,
  };
}

function extractionContentIdentity(
  manifest: ValveAssetExtractionManifest | null,
): Record<string, unknown> | null {
  if (!manifest) return null;
  return {
    schemaVersion: manifest.schemaVersion,
    vpkByteSize: manifest.vpk.byteSize,
    vpkSha256: manifest.vpk.sha256,
    source2ViewerVersion: manifest.source2Viewer.version,
    filters: manifest.source2Viewer.filters,
    extensions: manifest.source2Viewer.extensions,
    textureDecodeFlags: manifest.source2Viewer.textureDecodeFlags,
  };
}

async function buildVariants(
  source: ResolvedSource,
): Promise<PreparedAssetVariant[]> {
  const original: PreparedAssetVariant = {
    lodKey: "original",
    targetWidth: null,
    bytes: source.bytes,
    contentSha256: sha256(source.bytes),
    mimeType: source.mimeType,
    width: source.width,
    height: source.height,
    quality: null,
  };
  const derived = await Promise.all(
    ASSET_LODS.map(async (lod): Promise<PreparedAssetVariant> => {
      const result = await sharp(source.bytes, {
        failOn: "error",
        limitInputPixels: MAX_INPUT_PIXELS,
      })
        .rotate()
        .resize({ width: lod.targetWidth, withoutEnlargement: true })
        .webp({ quality: lod.quality, effort: 4, smartSubsample: true })
        .toBuffer({ resolveWithObject: true });
      return {
        lodKey: lod.key,
        targetWidth: lod.targetWidth,
        bytes: result.data,
        contentSha256: sha256(result.data),
        mimeType: "image/webp",
        width: result.info.width,
        height: result.info.height,
        quality: lod.quality,
      };
    }),
  );
  return [original, ...derived];
}

async function generatedFallback(job: AssetJob): Promise<ResolvedSource> {
  const digest = sha256(`${job.entityType}\0${job.entityKey}`);
  const hueA = Number.parseInt(digest.slice(0, 4), 16) % 360;
  const hueB =
    (hueA + 42 + (Number.parseInt(digest.slice(4, 6), 16) % 70)) % 360;
  const label = job.fallbackLabel;
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop stop-color="hsl(${hueA} 54% 30%)"/><stop offset="1" stop-color="hsl(${hueB} 62% 12%)"/>
      </linearGradient></defs>
      <rect width="256" height="256" fill="url(#g)"/>
      <path d="M18 196 78 42l54 90 44-70 62 134Z" fill="white" fill-opacity=".10"/>
      <rect x="9" y="9" width="238" height="238" fill="none" stroke="white" stroke-opacity=".22" stroke-width="4"/>
      <text x="128" y="150" text-anchor="middle" fill="white" fill-opacity=".88" font-family="Arial,sans-serif" font-weight="700" font-size="72">${label}</text>
    </svg>`,
    "utf8",
  );
  const result = await sharp(svg, { limitInputPixels: MAX_INPUT_PIXELS })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: result.data,
    mimeType: "image/png",
    width: result.info.width,
    height: result.info.height,
    logicalPath: `generated/${job.entityType}/${job.entityKey}.png`,
    sourceRepository: FALLBACK_SOURCE,
    sourceUrl: null,
    sourceKind: "generated",
  };
}

async function readCachedSource(
  root: string,
  vpkLogicalPath: string,
  cache: Map<string, Promise<ResolvedSource | null>>,
): Promise<ResolvedSource | null> {
  let pending = cache.get(vpkLogicalPath);
  if (!pending) {
    pending = readExtractedSource(root, vpkLogicalPath);
    cache.set(vpkLogicalPath, pending);
  }
  return pending;
}

async function readCachedSteamSource(
  path: string,
  cache: Map<string, Promise<ResolvedSource | null>>,
  fetcher?: SteamStaticFetcher,
): Promise<ResolvedSource | null> {
  let pending = cache.get(path);
  if (!pending) {
    pending = readSteamStaticSource(path, fetcher).then((source) =>
      source
        ? {
            ...source,
            sourceRepository: STEAM_STATIC_SOURCE,
            sourceKind: "steam_cdn" as const,
          }
        : null,
    );
    cache.set(path, pending);
  }
  return pending;
}

export async function readExtractedSource(
  root: string,
  vpkLogicalPath: string,
): Promise<ResolvedSource | null> {
  if (!isSafeLogicalPath(vpkLogicalPath)) return null;
  const candidates = extractedCandidates(vpkLogicalPath);
  for (const relativePath of candidates) {
    const absolutePath = resolve(root, relativePath);
    if (!absolutePath.startsWith(`${root}${sep}`)) continue;
    const actualPath = await realpath(absolutePath).catch(() => null);
    if (!actualPath || !actualPath.startsWith(`${root}${sep}`)) continue;
    const bytes = await readFile(actualPath).catch(() => null);
    if (!bytes) continue;
    const metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_INPUT_PIXELS,
    }).metadata();
    if (!metadata.width || !metadata.height || !metadata.format) {
      throw new Error(`Decoded asset has no dimensions: ${relativePath}`);
    }
    const mimeType = mimeForFormat(metadata.format);
    if (!mimeType)
      throw new Error(`Unsupported image format: ${metadata.format}`);
    return {
      bytes,
      mimeType,
      width: metadata.width,
      height: metadata.height,
      logicalPath: vpkLogicalPath,
      sourceRepository: VALVE_CLIENT_SOURCE,
      sourceUrl: null,
      sourceKind: "vpk",
    };
  }
  return null;
}

function extractedCandidates(vpkLogicalPath: string): string[] {
  const base = vpkLogicalPath.replace(/\.vtex_c$/u, "");
  const withoutPngMarker = base.replace(/_png$/u, "");
  return [
    `${base}.png`,
    `${withoutPngMarker}.png`,
    `${base}.webp`,
    `${withoutPngMarker}.webp`,
    `${base}.jpg`,
    `${withoutPngMarker}.jpg`,
  ];
}

function isSafeLogicalPath(path: string): boolean {
  return (
    /^[a-z0-9_./-]+$/u.test(path) &&
    !path.startsWith("/") &&
    !path.split("/").includes("..")
  );
}

function mimeForFormat(format: string): string | null {
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  return null;
}

async function validDirectory(path: string | null): Promise<string | null> {
  if (!path) return null;
  const root = await realpath(path).catch(() => null);
  if (!root) return null;
  const details = await stat(root).catch(() => null);
  return details?.isDirectory() ? root : null;
}

function initials(value: string): string {
  const parts = value.split(/[_\s/-]+/u).filter(Boolean);
  const selected = parts.length > 1 ? parts.slice(-2) : parts;
  return (
    selected
      .map((part) => part[0] ?? "")
      .join("")
      .replace(/[^a-z0-9]/giu, "")
      .slice(0, 2)
      .toUpperCase() || "?"
  );
}

function uniquePaths(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        output[index] = await mapper(values[index]);
      }
    }),
  );
  return output;
}
