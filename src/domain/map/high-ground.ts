import { DEFAULT_VISION_OPTIONS, type VisionScene } from "./vision";

/** Display-only bands share the solver's rounding; they never alter visibility. */
export const HIGH_GROUND_Z = DEFAULT_VISION_OPTIONS.heightBand * 1.5;
export const HIGHER_GROUND_Z = DEFAULT_VISION_OPTIONS.heightBand * 2.5;
export function highGroundRaster(terrain: VisionScene["terrain"]) {
  if (!terrain) return null;
  const width = terrain.width * 2,
    height = terrain.height * 2;
  const levels = new Uint8Array(width * height);
  const level = (z: number | null) =>
    z === null || !Number.isFinite(z) || z < HIGH_GROUND_Z
      ? 0
      : z < HIGHER_GROUND_Z
        ? 1
        : 2;
  let marked = 0;
  for (let i = 0; i < terrain.values.length; i++) {
    const x = (i % terrain.width) * 2,
      y = Math.floor(i / terrain.width) * 2;
    for (let q = 0; q < 4; q++) {
      const value = level(
        terrain.subcells?.[i] ? terrain.subcells[i][q] : terrain.values[i],
      );
      levels[(y + (q >> 1)) * width + x + (q % 2)] = value;
      if (value) marked++;
    }
  }
  if (!marked) return null;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        tier = levels[i];
      if (!tier) continue;
      const edge =
        x === 0 ||
        x === width - 1 ||
        y === 0 ||
        y === height - 1 ||
        levels[i - 1] < tier ||
        levels[i + 1] < tier ||
        levels[i - width] < tier ||
        levels[i + width] < tier;
      pixels.set(
        tier === 1
          ? [80, 190, 255, edge ? 240 : 35]
          : [210, 110, 255, edge ? 255 : 125],
        ((height - y - 1) * width + x) * 4,
      );
    }
  return {
    width,
    height,
    pixels,
    cell: terrain.cell / 2,
    origin: terrain.origin,
  };
}
