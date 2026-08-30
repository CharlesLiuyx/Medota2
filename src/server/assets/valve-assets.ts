import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { getOptionalPath, getOptionalValue } from "@/config/env";
import type { CanonicalAbility } from "@/domain/abilities";
import type { CanonicalHero } from "@/domain/heroes";
import { sha256 } from "@/lib/hash";

export const VALVE_ASSET_PROVIDER_VERSION = "extracted-v1";

export interface ValveAsset {
  bytes: Buffer;
  mimeType: string;
  sha256: string;
  logicalPath: string;
}

export interface ValveAssetRef {
  entityType: "hero" | "ability";
  entityKey: string;
  assetKind: "portrait" | "icon";
  logicalPath: string;
  clientVersion: string | null;
  contentSha256: string | null;
  mimeType: string | null;
  cacheStatus: "available" | "missing" | "mismatch" | "error";
}

export async function inspectValveCatalogAssets(
  heroes: readonly CanonicalHero[],
  abilities: readonly CanonicalAbility[],
  catalogClientVersion: string,
): Promise<ValveAssetRef[]> {
  const configured = getOptionalPath("DOTA_VALVE_ASSET_PATH");
  const assetClientVersion = getOptionalValue(
    "DOTA_VALVE_ASSET_CLIENT_VERSION",
  );
  const mismatch =
    Boolean(configured && assetClientVersion) &&
    assetClientVersion !== catalogClientVersion;
  const jobs = [
    ...heroes.map((hero) => ({
      entityType: "hero" as const,
      entityKey: hero.internalName,
      assetKind: "portrait" as const,
      logicalName: hero.internalName.replace(/^npc_dota_hero_/u, ""),
      logicalPath: `panorama/images/heroes/${hero.internalName.replace(/^npc_dota_hero_/u, "")}_png.png`,
    })),
    ...abilities.map((ability) => ({
      entityType: "ability" as const,
      entityKey: ability.internalName,
      assetKind: "icon" as const,
      logicalName: ability.textureName,
      logicalPath: `panorama/images/spellicons/${ability.textureName}_png.png`,
    })),
  ];
  if (!configured || mismatch) {
    return jobs.map((job) => ({
      entityType: job.entityType,
      entityKey: job.entityKey,
      assetKind: job.assetKind,
      logicalPath: job.logicalPath,
      clientVersion: assetClientVersion,
      contentSha256: null,
      mimeType: null,
      cacheStatus: mismatch ? "mismatch" : "missing",
    }));
  }
  return mapConcurrent(jobs, 16, async (job) => {
    try {
      const asset = await readValveAsset(job.entityType, job.logicalName);
      return {
        entityType: job.entityType,
        entityKey: job.entityKey,
        assetKind: job.assetKind,
        logicalPath: asset?.logicalPath ?? job.logicalPath,
        clientVersion: assetClientVersion,
        contentSha256: asset?.sha256 ?? null,
        mimeType: asset?.mimeType ?? null,
        cacheStatus: asset ? ("available" as const) : ("missing" as const),
      };
    } catch {
      return {
        entityType: job.entityType,
        entityKey: job.entityKey,
        assetKind: job.assetKind,
        logicalPath: job.logicalPath,
        clientVersion: assetClientVersion,
        contentSha256: null,
        mimeType: null,
        cacheStatus: "error" as const,
      };
    }
  });
}

export async function readValveAsset(
  entity: "hero" | "ability",
  logicalName: string,
): Promise<ValveAsset | null> {
  const configured = getOptionalPath("DOTA_VALVE_ASSET_PATH");
  if (!configured || !/^[a-z0-9_/-]+$/u.test(logicalName)) return null;
  const root = await realpath(configured).catch(() => null);
  if (!root || !(await stat(root)).isDirectory()) return null;
  const candidates =
    entity === "hero"
      ? [
          `panorama/images/heroes/${logicalName}_png.png`,
          `panorama/images/heroes/${logicalName}.png`,
          `panorama/images/heroes/icons/${logicalName}.png`,
        ]
      : [
          `panorama/images/spellicons/${logicalName}_png.png`,
          `panorama/images/spellicons/${logicalName}.png`,
        ];
  for (const logicalPath of candidates) {
    const absolute = resolve(root, logicalPath);
    if (!absolute.startsWith(`${root}${sep}`)) continue;
    const actual = await realpath(absolute).catch(() => null);
    if (!actual || !actual.startsWith(`${root}${sep}`)) continue;
    const bytes = await readFile(actual).catch(() => null);
    if (!bytes) continue;
    const mimeType = mime(extname(actual));
    if (!mimeType) continue;
    return { bytes, mimeType, sha256: sha256(bytes), logicalPath };
  }
  return null;
}

function mime(extension: string): string | null {
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  return null;
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
