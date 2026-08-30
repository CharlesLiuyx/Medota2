import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { CanonicalAbility } from "@/domain/abilities";
import type { CanonicalHero } from "@/domain/heroes";
import {
  inspectValveCatalogAssets,
  readValveAsset,
} from "@/server/assets/valve-assets";

const originalPath = process.env.DOTA_VALVE_ASSET_PATH;
const originalVersion = process.env.DOTA_VALVE_ASSET_CLIENT_VERSION;
const temporaryRoots: string[] = [];
const heroes = [
  { internalName: "npc_dota_hero_antimage" },
] as unknown as CanonicalHero[];
const abilities = [
  { internalName: "antimage_blink", textureName: "antimage_blink" },
] as unknown as CanonicalAbility[];

afterEach(async () => {
  restore("DOTA_VALVE_ASSET_PATH", originalPath);
  restore("DOTA_VALVE_ASSET_CLIENT_VERSION", originalVersion);
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Valve local asset provider", () => {
  it("indexes available assets and leaves missing assets as non-blocking refs", async () => {
    const root = await mkdtemp(join(tmpdir(), "medota2-assets-"));
    temporaryRoots.push(root);
    const heroDirectory = join(root, "panorama/images/heroes");
    await mkdir(heroDirectory, { recursive: true });
    await writeFile(join(heroDirectory, "antimage_png.png"), "fixture-png");
    process.env.DOTA_VALVE_ASSET_PATH = root;
    process.env.DOTA_VALVE_ASSET_CLIENT_VERSION = "6918";

    const refs = await inspectValveCatalogAssets(heroes, abilities, "6918");
    expect(refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "hero",
          entityKey: "npc_dota_hero_antimage",
          cacheStatus: "available",
          mimeType: "image/png",
        }),
        expect.objectContaining({
          entityType: "ability",
          entityKey: "antimage_blink",
          cacheStatus: "missing",
        }),
      ]),
    );
  });

  it("marks the entire provider mismatched without reading stale bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "medota2-assets-"));
    temporaryRoots.push(root);
    process.env.DOTA_VALVE_ASSET_PATH = root;
    process.env.DOTA_VALVE_ASSET_CLIENT_VERSION = "6917";

    const refs = await inspectValveCatalogAssets(heroes, abilities, "6918");
    expect(refs).toHaveLength(2);
    expect(refs.every((ref) => ref.cacheStatus === "mismatch")).toBe(true);
  });

  it("rejects unsafe logical names before resolving the filesystem", async () => {
    process.env.DOTA_VALVE_ASSET_PATH = "/tmp";
    await expect(readValveAsset("hero", "../../secret")).resolves.toBeNull();
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
