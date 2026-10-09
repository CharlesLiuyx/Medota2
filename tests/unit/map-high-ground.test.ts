import { expect, it } from "vitest";
import {
  highGroundRaster,
  HIGH_GROUND_Z,
  HIGHER_GROUND_Z,
} from "@/domain/map/high-ground";
it("marks solver-aligned high ground, preserves missing seam quarters and flips world Y for the canvas", () => {
  const raster = highGroundRaster({
    cell: 32,
    width: 2,
    height: 2,
    origin: { x: -64, y: 128 },
    values: [128, 256, 384, null],
    subcells: { 1: [null, 192, 319, 320] },
  })!;
  const pixel = (x: number, y: number) =>
    Array.from(
      raster.pixels.slice(
        ((raster.height - 1 - y) * raster.width + x) * 4,
        ((raster.height - 1 - y) * raster.width + x) * 4 + 4,
      ),
    );
  expect([HIGH_GROUND_Z, HIGHER_GROUND_Z]).toEqual([192, 320]);
  expect(raster).toMatchObject({
    width: 4,
    height: 4,
    cell: 16,
    origin: { x: -64, y: 128 },
  });
  expect(pixel(0, 0)).toEqual([0, 0, 0, 0]);
  expect(pixel(2, 0)).toEqual([0, 0, 0, 0]);
  expect(pixel(3, 0)).toEqual([80, 190, 255, 240]);
  expect(pixel(2, 1)).toEqual([80, 190, 255, 240]);
  expect(pixel(3, 1)).toEqual([210, 110, 255, 255]);
  expect(pixel(0, 3)).toEqual([210, 110, 255, 255]);
  expect(pixel(3, 3)).toEqual([0, 0, 0, 0]);
  expect(highGroundRaster(null)).toBeNull();
  expect(
    highGroundRaster({
      cell: 32,
      width: 1,
      height: 1,
      origin: { x: 0, y: 0 },
      values: [191],
    }),
  ).toBeNull();
});

it("fills the interior of higher terrain visibly", () => {
  const raster = highGroundRaster({
    cell: 32,
    width: 3,
    height: 3,
    origin: { x: 0, y: 0 },
    values: Array(9).fill(384),
  })!;
  expect(
    Array.from(raster.pixels.slice((2 * 6 + 2) * 4, (2 * 6 + 2) * 4 + 4)),
  ).toEqual([210, 110, 255, 125]);
});
