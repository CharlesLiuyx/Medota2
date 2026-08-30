import { describe, expect, it } from "vitest";
import valveAssetImageLoader from "@/components/valve-asset-image-loader";

describe("Valve asset image loader", () => {
  it("requests the browser-selected width from the database asset route", () => {
    expect(
      valveAssetImageLoader({
        src: "/valve-assets/ability/antimage_blink",
        width: 128,
        quality: 75,
      }),
    ).toBe("/valve-assets/ability/antimage_blink?width=128");
  });

  it("preserves an existing query string", () => {
    expect(
      valveAssetImageLoader({
        src: "/valve-assets/hero/npc_dota_hero_antimage?v=asset-dataset-2",
        width: 64,
        quality: undefined,
      }),
    ).toBe(
      "/valve-assets/hero/npc_dota_hero_antimage?v=asset-dataset-2&width=64",
    );
  });
});
