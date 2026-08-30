import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

export const STEAM_STATIC_SOURCE = "Valve Steam static CDN";
export const STEAM_STATIC_ORIGIN = "https://cdn.steamstatic.com";

const DOTA_REACT_PREFIX = "/apps/dota2/images/dota_react/";
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_INPUT_PIXELS = 16_777_216;
const ALLOWED_FINAL_HOSTS = new Set([
  "cdn.steamstatic.com",
  "cdn.akamai.steamstatic.com",
  "steamcdn-a.akamaihd.net",
]);

export interface SteamStaticImageMap {
  heroes: Map<string, string>;
  abilities: Map<string, string>;
}

export interface SteamStaticSource {
  bytes: Buffer;
  mimeType: string;
  width: number;
  height: number;
  logicalPath: string;
  sourceUrl: string;
}

export type SteamStaticFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export async function loadDotaconstantsSteamImageMap(
  dotaconstantsRoot: string,
): Promise<SteamStaticImageMap> {
  const [heroesJson, abilitiesJson] = await Promise.all([
    readFile(resolve(dotaconstantsRoot, "build/heroes.json"), "utf8"),
    readFile(resolve(dotaconstantsRoot, "build/abilities.json"), "utf8"),
  ]);
  const heroes = new Map<string, string>();
  for (const value of Object.values(parseRecord(heroesJson, "heroes.json"))) {
    if (!isRecord(value) || typeof value.name !== "string") continue;
    const path = normalizedDotaReactPath(value.img);
    if (path) heroes.set(value.name, path);
  }
  const abilities = new Map<string, string>();
  for (const [internalName, value] of Object.entries(
    parseRecord(abilitiesJson, "abilities.json"),
  )) {
    if (!isRecord(value)) continue;
    const path = normalizedDotaReactPath(value.img);
    if (path) abilities.set(internalName, path);
  }
  return { heroes, abilities };
}

export function derivedSteamHeroPath(internalName: string): string | null {
  const slug = internalName.replace(/^npc_dota_hero_/u, "");
  return safeSlug(slug) ? `${DOTA_REACT_PREFIX}heroes/${slug}.png` : null;
}

export function derivedSteamAbilityPath(textureName: string): string | null {
  return safeSlug(textureName)
    ? `${DOTA_REACT_PREFIX}abilities/${textureName}.png`
    : null;
}

export function steamAliasPath(vpkLogicalPath: string): string | null {
  const spellIcon = /^panorama\/images\/spellicons\/(.+)_png\.vtex_c$/u.exec(
    vpkLogicalPath,
  );
  if (spellIcon?.[1] && safeSlug(spellIcon[1])) {
    return `${DOTA_REACT_PREFIX}abilities/${spellIcon[1]}.png`;
  }
  if (
    vpkLogicalPath ===
      "panorama/images/hud/facets/innate_icon_large_png.vtex_c" ||
    vpkLogicalPath === "panorama/images/hud/facets/innate_icon_png.vtex_c"
  ) {
    return `${DOTA_REACT_PREFIX}icons/innate_icon.png`;
  }
  return null;
}

export async function readSteamStaticSource(
  path: string,
  fetcher: SteamStaticFetcher = fetch,
): Promise<SteamStaticSource | null> {
  const normalizedPath = normalizedDotaReactPath(path);
  if (!normalizedPath) return null;
  const sourceUrl = new URL(normalizedPath, STEAM_STATIC_ORIGIN).href;
  const response = await fetcher(sourceUrl, {
    headers: {
      Accept: "image/png,image/webp,image/jpeg",
      "User-Agent": "Medota2 asset importer",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Steam static asset returned HTTP ${response.status}.`);
  }
  const finalUrl = response.url || sourceUrl;
  const parsedFinalUrl = new URL(finalUrl);
  if (
    parsedFinalUrl.protocol !== "https:" ||
    !ALLOWED_FINAL_HOSTS.has(parsedFinalUrl.hostname)
  ) {
    throw new Error(`Steam static asset redirected to an untrusted host.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Steam static asset exceeds the download size limit.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Steam static asset has an invalid byte size.`);
  }
  const metadata = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: MAX_INPUT_PIXELS,
  }).metadata();
  if (!metadata.width || !metadata.height || !metadata.format) {
    throw new Error(`Steam static asset has no image dimensions.`);
  }
  const mimeType = mimeForFormat(metadata.format);
  if (!mimeType) {
    throw new Error(`Unsupported Steam static format: ${metadata.format}.`);
  }
  return {
    bytes,
    mimeType,
    width: metadata.width,
    height: metadata.height,
    logicalPath: normalizedPath,
    sourceUrl: finalUrl,
  };
}

function normalizedDotaReactPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.split("?", 1)[0];
  if (
    !path.startsWith(DOTA_REACT_PREFIX) ||
    path.includes("..") ||
    !/^\/[a-z0-9_./-]+\.(?:png|webp|jpe?g)$/u.test(path)
  ) {
    return null;
  }
  return path;
}

function safeSlug(value: string): boolean {
  return (
    /^[a-z0-9_./-]+$/u.test(value) &&
    !value.startsWith("/") &&
    !value.split("/").includes("..")
  );
}

function parseRecord(text: string, label: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error(`${label} must contain an object.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mimeForFormat(format: string): string | null {
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  return null;
}
