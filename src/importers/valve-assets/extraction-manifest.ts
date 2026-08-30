import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const VALVE_ASSET_EXTRACTION_MANIFEST_FILE =
  "medota2-valve-asset-extraction.json";
export const VALVE_ASSET_EXTRACTION_SCHEMA = "medota2.valve-asset-extraction";
export const VALVE_ASSET_EXTRACTION_SCHEMA_VERSION = 1 as const;

export const VALVE_ASSET_VPK_PATH_FILTERS = [
  "panorama/images/heroes/icons/",
  "panorama/images/heroes/npc_dota_hero_",
  "panorama/images/spellicons/",
  "panorama/images/hud/facets/innate_icon",
] as const;

export const VALVE_ASSET_VPK_EXTENSIONS = ["vtex_c"] as const;
export const VALVE_ASSET_TEXTURE_DECODE_FLAGS = "auto" as const;

export interface ValveAssetExtractionManifest {
  schema: typeof VALVE_ASSET_EXTRACTION_SCHEMA;
  schemaVersion: typeof VALVE_ASSET_EXTRACTION_SCHEMA_VERSION;
  clientVersion: string;
  extractedAt: string;
  vpk: {
    byteSize: number;
    sha256: string;
  };
  source2Viewer: {
    version: string;
    arguments: string[];
    filters: string[];
    extensions: string[];
    textureDecodeFlags: string;
    threads: number;
  };
  extractedFileCount: number;
}

export interface ValveAssetExtractionExpectations {
  clientVersion?: string;
  vpkSha256?: string;
}

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const manifestSchema = z
  .object({
    schema: z.literal(VALVE_ASSET_EXTRACTION_SCHEMA),
    schemaVersion: z.literal(VALVE_ASSET_EXTRACTION_SCHEMA_VERSION),
    clientVersion: z.string().regex(/^\d+$/u),
    extractedAt: z.iso.datetime({ offset: true }),
    vpk: z
      .object({
        byteSize: z.number().int().positive(),
        sha256: sha256Schema,
      })
      .strict(),
    source2Viewer: z
      .object({
        version: z.string().trim().min(1).max(4096),
        arguments: z.array(z.string().max(4096)).min(1),
        filters: z.array(z.string().min(1)),
        extensions: z.array(z.string().min(1)),
        textureDecodeFlags: z.string().min(1),
        threads: z.number().int().positive(),
      })
      .strict(),
    extractedFileCount: z.number().int().positive(),
  })
  .strict();

export async function readValveAssetExtractionManifest(
  assetRoot: string,
  expectations: ValveAssetExtractionExpectations = {},
): Promise<ValveAssetExtractionManifest> {
  const path = join(assetRoot, VALVE_ASSET_EXTRACTION_MANIFEST_FILE);
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not read Valve asset extraction manifest at ${path}: ${message}`,
    );
  }
  return validateValveAssetExtractionManifest(parsedJson, expectations);
}

export function validateValveAssetExtractionManifest(
  value: unknown,
  expectations: ValveAssetExtractionExpectations = {},
): ValveAssetExtractionManifest {
  const result = manifestSchema.safeParse(value);
  if (!result.success) {
    throw new Error(
      `Invalid Valve asset extraction manifest: ${z.prettifyError(result.error)}`,
    );
  }
  const manifest = result.data;
  assertExactList(
    "Source2Viewer filters",
    manifest.source2Viewer.filters,
    VALVE_ASSET_VPK_PATH_FILTERS,
  );
  assertExactList(
    "Source2Viewer extensions",
    manifest.source2Viewer.extensions,
    VALVE_ASSET_VPK_EXTENSIONS,
  );
  if (
    manifest.source2Viewer.textureDecodeFlags !==
    VALVE_ASSET_TEXTURE_DECODE_FLAGS
  ) {
    throw new Error(
      `Valve asset extraction manifest has unsupported texture decode flags: ${manifest.source2Viewer.textureDecodeFlags}.`,
    );
  }
  if (
    expectations.clientVersion &&
    manifest.clientVersion !== expectations.clientVersion
  ) {
    throw new Error(
      `Valve asset ClientVersion mismatch: manifest=${manifest.clientVersion}, expected=${expectations.clientVersion}.`,
    );
  }
  if (
    expectations.vpkSha256 &&
    manifest.vpk.sha256 !== expectations.vpkSha256
  ) {
    throw new Error(
      `Valve asset VPK SHA-256 mismatch: manifest=${manifest.vpk.sha256}, expected=${expectations.vpkSha256}.`,
    );
  }
  return manifest;
}

function assertExactList(
  label: string,
  actual: readonly string[],
  expected: readonly string[],
): void {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(`${label} do not match this Medota2 extractor version.`);
  }
}
