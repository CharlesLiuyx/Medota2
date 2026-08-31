import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareCatalogAssets,
  readExtractedSource,
} from "@/importers/valve-assets/catalog-assets";
import {
  VALVE_ASSET_EXTRACTION_MANIFEST_FILE,
  VALVE_ASSET_EXTRACTION_SCHEMA,
  VALVE_ASSET_EXTRACTION_SCHEMA_VERSION,
  VALVE_ASSET_TEXTURE_DECODE_FLAGS,
  VALVE_ASSET_VPK_EXTENSIONS,
  VALVE_ASSET_VPK_PATH_FILTERS,
} from "@/importers/valve-assets/extraction-manifest";
import type { SteamStaticFetcher } from "@/importers/valve-assets/steam-static-assets";

const roots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("database-backed catalog asset preparation", () => {
  it("generates deterministic, entity-specific images with every LoD", async () => {
    const input = {
      heroes: [{ internalName: "npc_dota_hero_antimage" }],
      abilities: [
        {
          internalName: "antimage_blink",
          textureName: "antimage_blink",
          definitionKind: "ability",
          isInnate: false,
        },
      ],
    };
    const first = await prepareCatalogAssets(
      input.heroes,
      input.abilities,
      "6918",
      { sourceRoot: null, assetClientVersion: null },
    );
    const second = await prepareCatalogAssets(
      input.heroes,
      input.abilities,
      "6918",
      { sourceRoot: null, assetClientVersion: null },
    );

    expect(first.counts).toMatchObject({
      heroes: 1,
      abilities: 1,
      generatedFallback: 2,
      total: 2,
    });
    expect(first.manifestSha256).toBe(second.manifestSha256);
    expect(first.assets.map((asset) => asset.objectSha256)).toEqual(
      second.assets.map((asset) => asset.objectSha256),
    );
    expect(new Set(first.assets.map((asset) => asset.objectSha256)).size).toBe(
      2,
    );
    for (const asset of first.assets) {
      expect(asset.variants.map((variant) => variant.lodKey)).toEqual([
        "original",
        "w64",
        "w128",
        "w256",
      ]);
      expect(asset.variants.every((variant) => variant.bytes.length > 0)).toBe(
        true,
      );
      expect(asset.variants[1]).toMatchObject({
        mimeType: "image/webp",
        width: 64,
        height: 64,
      });
    }
  });

  it("uses exact VRF paths, preserves texture subdirectories and resolves Valve aliases", async () => {
    const root = await mkdtemp(join(tmpdir(), "medota2-catalog-assets-"));
    roots.push(root);
    await writePng(
      join(root, "panorama/images/heroes/icons/npc_dota_hero_antimage_png.png"),
      96,
      96,
      "#b91c1c",
    );
    await writePng(
      join(root, "panorama/images/spellicons/consumables/test_icon_png.png"),
      128,
      96,
      "#1d4ed8",
    );
    await writePng(
      join(root, "panorama/images/spellicons/attribute_bonus_png.png"),
      128,
      128,
      "#15803d",
    );
    await writeExtractionManifest(root, "6918");

    const result = await prepareCatalogAssets(
      [{ internalName: "npc_dota_hero_antimage" }],
      [
        {
          internalName: "fixture_override",
          textureName: "consumables/test_icon",
          definitionKind: "ability",
          isInnate: false,
        },
        {
          internalName: "special_bonus_fixture",
          textureName: "special_bonus_fixture",
          definitionKind: "talent",
          isInnate: false,
        },
      ],
      "6918",
      { sourceRoot: root, assetClientVersion: "6918" },
    );

    expect(result.counts).toMatchObject({ exact: 2, alias: 1 });
    expect(
      result.assets.find((asset) => asset.entityKey === "fixture_override"),
    ).toMatchObject({
      resolutionKind: "exact",
      resolvedLogicalPath:
        "panorama/images/spellicons/consumables/test_icon_png.vtex_c",
    });
    expect(
      result.assets.find(
        (asset) => asset.entityKey === "special_bonus_fixture",
      ),
    ).toMatchObject({
      resolutionKind: "alias",
      resolvedLogicalPath:
        "panorama/images/spellicons/attribute_bonus_png.vtex_c",
    });
  });

  it("downloads official Hero and Ability images before using a real Valve alias", async () => {
    const root = await mkdtemp(join(tmpdir(), "medota2-dotaconstants-"));
    roots.push(root);
    await mkdir(join(root, "build"), { recursive: true });
    await Promise.all([
      writeFile(
        join(root, "build/heroes.json"),
        JSON.stringify({
          2: {
            name: "npc_dota_hero_axe",
            img: "/apps/dota2/images/dota_react/heroes/axe.png?",
          },
        }),
      ),
      writeFile(
        join(root, "build/abilities.json"),
        JSON.stringify({
          axe_berserkers_call: {
            img: "/apps/dota2/images/dota_react/abilities/axe_berserkers_call.png",
          },
        }),
      ),
    ]);
    await initializeDotaconstantsCheckout(root);
    const [heroBytes, abilityBytes, emptyBytes] = await Promise.all([
      pngBytes(256, 144, "#b91c1c"),
      pngBytes(128, 128, "#1d4ed8"),
      pngBytes(128, 128, "#111827"),
    ]);
    const fetcher: SteamStaticFetcher = async (input) => {
      const bytes = input.endsWith("/heroes/axe.png")
        ? heroBytes
        : input.endsWith("/abilities/axe_berserkers_call.png")
          ? abilityBytes
          : input.endsWith("/abilities/empty.png")
            ? emptyBytes
            : null;
      return bytes
        ? new Response(new Uint8Array(bytes), {
            status: 200,
            headers: { "content-type": "image/png" },
          })
        : new Response(null, { status: 404 });
    };

    const result = await prepareCatalogAssets(
      [{ internalName: "npc_dota_hero_axe" }],
      [
        {
          internalName: "axe_berserkers_call",
          textureName: "axe_berserkers_call",
          definitionKind: "ability",
          isInnate: false,
        },
        {
          internalName: "generic_hidden",
          textureName: "generic_hidden",
          definitionKind: "ability",
          isInnate: false,
        },
      ],
      "6918",
      {
        sourceRoot: null,
        assetClientVersion: null,
        downloadMissing: true,
        dotaconstantsRoot: root,
        steamFetcher: fetcher,
      },
    );

    expect(result.counts).toMatchObject({
      exact: 2,
      alias: 1,
      generatedFallback: 0,
      total: 3,
    });
    expect(result.sourceProvenance.dotaconstantsImageMap).toMatchObject({
      sourceRepository: "odota/dotaconstants",
      sourceRemoteUrl: "https://github.com/odota/dotaconstants.git",
      sourceDirty: false,
      sourceInputsMatchHead: true,
      files: [
        { sourcePath: "build/heroes.json" },
        { sourcePath: "build/abilities.json" },
      ],
    });
    expect(result.sourceProvenance.dotaconstantsImageMap?.sourceCommit).toMatch(
      /^[0-9a-f]{40}$/u,
    );
    expect(
      result.sourceProvenance.dotaconstantsImageMap?.manifestSha256,
    ).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      result.assets.find((asset) => asset.entityKey === "npc_dota_hero_axe"),
    ).toMatchObject({
      resolutionKind: "exact",
      sourceRepository: "Valve Steam static CDN",
      metadata: {
        sourceUrl:
          "https://cdn.steamstatic.com/apps/dota2/images/dota_react/heroes/axe.png",
      },
    });
    expect(
      result.assets.find((asset) => asset.entityKey === "generic_hidden"),
    ).toMatchObject({
      resolutionKind: "alias",
      resolvedLogicalPath: "/apps/dota2/images/dota_react/abilities/empty.png",
    });
  });

  it("refuses path traversal and never reads a mismatched client tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "medota2-catalog-assets-"));
    roots.push(root);
    await expect(
      readExtractedSource(root, "../../private.png"),
    ).resolves.toBeNull();
    await writeExtractionManifest(root, "6917");
    const result = await prepareCatalogAssets(
      [{ internalName: "npc_dota_hero_antimage" }],
      [],
      "6918",
      { sourceRoot: root, assetClientVersion: "6917" },
    );
    expect(result.assets[0]).toMatchObject({
      resolutionKind: "generated_fallback",
      sourceStatus: "mismatch",
    });
  });

  it("rejects a configured extraction directory without provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "medota2-catalog-assets-"));
    roots.push(root);

    await expect(
      prepareCatalogAssets(
        [{ internalName: "npc_dota_hero_antimage" }],
        [],
        "6918",
        { sourceRoot: root, assetClientVersion: "6918" },
      ),
    ).rejects.toThrow("Could not read Valve asset extraction manifest");
  });

  it("falls back when metadata succeeds but full image decoding fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "medota2-catalog-assets-"));
    roots.push(root);
    const path = join(
      root,
      "panorama/images/heroes/icons/npc_dota_hero_antimage_png.png",
    );
    await mkdir(dirname(path), { recursive: true });
    const png = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 4,
        background: "#7f1d1d",
      },
    })
      .png()
      .toBuffer();
    const truncated = png.subarray(0, 64);
    await expect(sharp(truncated).metadata()).resolves.toMatchObject({
      width: 128,
      height: 128,
    });
    await writeFile(path, truncated);
    await writeExtractionManifest(root, "6918");

    const result = await prepareCatalogAssets(
      [{ internalName: "npc_dota_hero_antimage" }],
      [],
      "6918",
      { sourceRoot: root, assetClientVersion: "6918" },
    );

    expect(result.assets[0]).toMatchObject({
      resolutionKind: "generated_fallback",
      sourceStatus: "error",
    });
    expect(result.counts.errors).toBe(1);
  });

  it("keeps catalog and binding provenance out of deduplicated object metadata", async () => {
    const hero = [{ internalName: "npc_dota_hero_antimage" }];
    const first = await prepareCatalogAssets(hero, [], "6918", {
      sourceRoot: null,
      assetClientVersion: null,
      catalogSourceCommit: "a".repeat(40),
    });
    const second = await prepareCatalogAssets(hero, [], "6918", {
      sourceRoot: null,
      assetClientVersion: null,
      catalogSourceCommit: "b".repeat(40),
    });

    expect(first.assets[0].objectSha256).toBe(second.assets[0].objectSha256);
    expect(first.assets[0].sourceStatus).toBe("fallback");
    expect(first.assets[0].metadata).not.toHaveProperty("catalogSourceCommit");
    expect(first.assets[0].metadata).not.toHaveProperty("sourceStatus");
    expect(second.assets[0].metadata).toEqual(first.assets[0].metadata);
  });

  it("keeps per-binding source status when an alias object is reused", async () => {
    const cleanRoot = await mkdtemp(
      join(tmpdir(), "medota2-catalog-assets-clean-"),
    );
    const errorRoot = await mkdtemp(
      join(tmpdir(), "medota2-catalog-assets-error-"),
    );
    roots.push(cleanRoot, errorRoot);
    const alias = "panorama/images/heroes/icons/npc_dota_hero_default_png.png";
    await Promise.all([
      writePng(join(cleanRoot, alias), 96, 96, "#b91c1c"),
      writePng(join(errorRoot, alias), 96, 96, "#b91c1c"),
      writeExtractionManifest(cleanRoot, "6918"),
      writeExtractionManifest(errorRoot, "6918"),
    ]);

    const exactPath = join(
      errorRoot,
      "panorama/images/heroes/icons/npc_dota_hero_antimage_png.png",
    );
    await mkdir(dirname(exactPath), { recursive: true });
    const exactPng = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 4,
        background: "#7f1d1d",
      },
    })
      .png()
      .toBuffer();
    await writeFile(exactPath, exactPng.subarray(0, 64));

    const hero = [{ internalName: "npc_dota_hero_antimage" }];
    const clean = await prepareCatalogAssets(hero, [], "6918", {
      sourceRoot: cleanRoot,
      assetClientVersion: "6918",
    });
    const errored = await prepareCatalogAssets(hero, [], "6918", {
      sourceRoot: errorRoot,
      assetClientVersion: "6918",
    });

    expect(clean.assets[0]).toMatchObject({
      resolutionKind: "alias",
      sourceStatus: "fallback",
    });
    expect(errored.assets[0]).toMatchObject({
      resolutionKind: "alias",
      sourceStatus: "error",
    });
    expect(errored.assets[0].objectSha256).toBe(clean.assets[0].objectSha256);
    expect(errored.assets[0].metadata).toEqual(clean.assets[0].metadata);
    expect(clean.assets[0].metadata).not.toHaveProperty("sourceStatus");
  });
});

async function initializeDotaconstantsCheckout(root: string): Promise<void> {
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Medota2 Test"], {
    cwd: root,
  });
  await execFileAsync(
    "git",
    ["config", "user.email", "medota2-test@example.invalid"],
    { cwd: root },
  );
  await execFileAsync(
    "git",
    ["remote", "add", "origin", "https://github.com/odota/dotaconstants.git"],
    { cwd: root },
  );
  await execFileAsync(
    "git",
    ["add", "build/heroes.json", "build/abilities.json"],
    {
      cwd: root,
    },
  );
  await execFileAsync("git", ["commit", "--quiet", "-m", "fixture"], {
    cwd: root,
  });
}

async function writeExtractionManifest(
  root: string,
  clientVersion: string,
): Promise<void> {
  await writeFile(
    join(root, VALVE_ASSET_EXTRACTION_MANIFEST_FILE),
    JSON.stringify({
      schema: VALVE_ASSET_EXTRACTION_SCHEMA,
      schemaVersion: VALVE_ASSET_EXTRACTION_SCHEMA_VERSION,
      clientVersion,
      extractedAt: "2026-08-31T00:00:00.000Z",
      vpk: { byteSize: 1024, sha256: "a".repeat(64) },
      source2Viewer: {
        version: "Source2Viewer-CLI fixture",
        arguments: ["--input", "fixture.vpk"],
        filters: [...VALVE_ASSET_VPK_PATH_FILTERS],
        extensions: [...VALVE_ASSET_VPK_EXTENSIONS],
        textureDecodeFlags: VALVE_ASSET_TEXTURE_DECODE_FLAGS,
        threads: 1,
      },
      extractedFileCount: 1,
    }),
  );
}

async function writePng(
  path: string,
  width: number,
  height: number,
  background: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const bytes = await sharp({
    create: { width, height, channels: 4, background },
  })
    .png()
    .toBuffer();
  await writeFile(path, bytes);
}

async function pngBytes(
  width: number,
  height: number,
  background: string,
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background },
  })
    .png()
    .toBuffer();
}
