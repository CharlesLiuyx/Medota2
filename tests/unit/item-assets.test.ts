import { expect, it, vi } from "vitest";
import sharp from "sharp";
import { adaptItems } from "@/importers/dota-vpk/item-adapter";
import { prepareItemAssets } from "@/importers/valve-assets/item-assets";
const source = vi.hoisted(() => vi.fn());
vi.mock("@/importers/valve-assets/steam-static-assets", async (original) => ({
  ...(await original<object>()),
  readSteamStaticSource: source,
}));
const { items } = adaptItems(
  '"DOTAAbilities" { "item_blink" {} "item_recipe_blink" { "ItemRecipe" "1" } "item_recipe_test" { "ItemRecipe" "1" } }',
  {},
  {},
);
it("preserves native item artwork, shares the recipe icon and retains verified bytes in four LoDs", async () => {
  const bytes = await sharp({
    create: { width: 88, height: 64, channels: 3, background: "#223344" },
  })
    .png()
    .toBuffer();
  source.mockReset().mockImplementation(async (path: string) => ({
    bytes,
    mimeType: "image/png",
    width: 88,
    height: 64,
    logicalPath: path,
    sourceUrl: `https://cdn.steamstatic.com${path}`,
  }));
  const { bindings } = await prepareItemAssets(items);
  expect(source).toHaveBeenCalledTimes(2);
  expect(bindings.map((b) => b.resolution)).toEqual([
    "icon",
    "shared_icon",
    "shared_icon",
  ]);
  expect(bindings[1].asset.objectSha256).toBe(bindings[2].asset.objectSha256);
  for (const binding of bindings) {
    expect(binding.asset.variants.map((v) => v.lodKey)).toEqual([
      "original",
      "w64",
      "w128",
      "w256",
    ]);
    expect(binding.asset.variants[0].bytes).toEqual(bytes);
    expect(binding.provenance).toMatchObject({
      source_commit: null,
      client_version: null,
    });
  }
});
it("fails the whole import when any native image is missing or identity is duplicated", async () => {
  source.mockReset().mockResolvedValue(null);
  await expect(prepareItemAssets(items)).rejects.toThrow(
    "Missing native item images",
  );
  await expect(prepareItemAssets([items[0], items[0]])).rejects.toThrow(
    "unique",
  );
});
