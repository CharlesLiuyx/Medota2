import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { prepareHeroMinimapAssets } from "@/importers/valve-assets/hero-minimap-assets";
import { canonicalJsonSha256 } from "@/lib/hash";
import manifest from "@/data/map/hero-minimap-icons.v1.json";
const source = vi.hoisted(() => vi.fn());
vi.mock("@/importers/valve-assets/steam-static-assets", async (original) => ({
  ...(await original<object>()),
  readSteamStaticSource: source,
}));
it("uses native minimap artwork, preserves non-square icons and all four LoDs", async () => {
  const bytes = await sharp({
    create: { width: 32, height: 31, channels: 4, background: "#223344" },
  })
    .png()
    .toBuffer();
  source.mockReset().mockImplementation(async (path: string) => ({
    bytes,
    mimeType: "image/png",
    width: 32,
    height: 31,
    logicalPath: path,
    sourceUrl: `https://cdn.steamstatic.com${path}`,
  }));
  const assets = await prepareHeroMinimapAssets(["npc_dota_hero_muerta"]);
  expect(source).toHaveBeenCalledWith(
    "/apps/dota2/images/dota_react/heroes/icons/muerta.png",
  );
  expect(assets[0].variants[0].bytes).toEqual(bytes);
  expect(assets[0].variants.map((v) => v.lodKey)).toEqual([
    "original",
    "w64",
    "w128",
    "w256",
  ]);
  expect(assets[0].metadata).toMatchObject({
    hero_key: "npc_dota_hero_muerta",
    source_commit: null,
    client_version: null,
  });
  expect(
    (await prepareHeroMinimapAssets(["npc_dota_hero_muerta"]))[0].objectSha256,
  ).toBe(assets[0].objectSha256);
  source.mockResolvedValue(null);
  await expect(prepareHeroMinimapAssets(["npc_dota_hero_axe"])).rejects.toThrow(
    "Missing native hero minimap icons",
  );
  await expect(
    prepareHeroMinimapAssets(["npc_dota_hero_axe", "npc_dota_hero_axe"]),
  ).rejects.toThrow("unique");
});
it("keeps the checked-in manifest content-addressed with unique hero identities", () => {
  const { manifestSha256, ...body } = manifest;
  expect(canonicalJsonSha256(body)).toBe(manifestSha256);
  expect(new Set(body.assets.map((a) => a.key)).size).toBe(body.assets.length);
  expect(body.catalogs.length).toBeGreaterThan(0);
  for (const asset of body.assets) {
    expect(asset.objectSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(asset.sourceUrl).toContain("/heroes/icons/");
  }
});
