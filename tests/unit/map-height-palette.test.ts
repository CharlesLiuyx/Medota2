import { expect, it } from "vitest";
import { HEIGHT_BANDS, recolorHeightPixels } from "@/domain/map/height-palette";
import { terrainPixels } from "@/importers/dota-map/terrain";

it("keeps height boundaries and stored asset colors while improving display contrast", () => {
  const heights = [
    63,
    64,
    191,
    192,
    319,
    320,
    447,
    448,
    575,
    576,
    703,
    704,
    null,
  ];
  const bands = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6];
  const { elevation } = terrainPixels(
    {
      cell: 32,
      width: heights.length,
      height: 1,
      cells: Buffer.alloc(heights.length),
      bounds: { minX: 0, maxX: heights.length * 32, minY: 0, maxY: 32 },
    },
    {
      cell: 32,
      width: heights.length,
      height: 1,
      samples: 1,
      origin: { x: 0, y: 0 },
      heightAt: (x) => heights[Math.floor(x / 32)],
    },
  );
  expect([...elevation.slice(9 * 4, 10 * 4)]).toEqual([176, 86, 176, 150]);
  const display = new Uint8ClampedArray(elevation);
  expect(recolorHeightPixels(display)).toBe(12);
  bands.forEach((band, index) =>
    expect([...display.slice(index * 4, index * 4 + 4)]).toEqual(
      HEIGHT_BANDS[band].display,
    ),
  );
  expect([...display.slice(-4)]).toEqual([0, 0, 0, 0]);
  expect([...display.slice(9 * 4, 10 * 4)]).toEqual([168, 58, 255, 240]);
  expect([...display.slice(5 * 4, 6 * 4)]).toEqual([255, 144, 0, 250]);
  expect([...display.slice(7 * 4, 8 * 4)]).toEqual([255, 50, 68, 235]);
});

it("accepts canvas rounding without assigning unknown or transparent pixels a height", () => {
  const pixels = new Uint8ClampedArray([
    175, 87, 176, 150, 176, 86, 176, 0, 1, 2, 3, 150,
  ]);
  expect(recolorHeightPixels(pixels)).toBe(1);
  expect([...pixels]).toEqual([
    168, 58, 255, 240, 176, 86, 176, 0, 1, 2, 3, 150,
  ]);
  expect(recolorHeightPixels(pixels)).toBe(0);
  expect([...pixels.slice(0, 4)]).toEqual([168, 58, 255, 240]);
});
