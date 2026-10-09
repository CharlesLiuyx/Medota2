/** Stored map-package colors identify the original seven height bands. */
export const HEIGHT_BANDS = [
  { stored: [52, 132, 218, 150], display: [38, 126, 238, 185] },
  { stored: [88, 170, 72, 150], display: [66, 164, 74, 175] },
  { stored: [206, 194, 72, 150], display: [243, 217, 60, 195] },
  { stored: [228, 144, 56, 150], display: [255, 144, 0, 250] },
  { stored: [214, 84, 62, 150], display: [255, 50, 68, 235] },
  { stored: [176, 86, 176, 150], display: [168, 58, 255, 240] },
  { stored: [180, 190, 205, 150], display: [214, 231, 239, 215] },
] as const;

export const HEIGHT_PALETTE_KEY = HEIGHT_BANDS.map((band) =>
  band.display.join(","),
).join(";");

const colors = new Map<number, (typeof HEIGHT_BANDS)[number]["display"]>();
// Browser Canvas may round RGB during premultiplication of the stored alpha.
// Match only a small tolerance around known colors, never infer an unknown band.
for (const band of HEIGHT_BANDS)
  for (let r = -2; r <= 2; r++)
    for (let g = -2; g <= 2; g++)
      for (let b = -2; b <= 2; b++)
        colors.set(
          ((band.stored[0] + r) << 16) |
            ((band.stored[1] + g) << 8) |
            (band.stored[2] + b),
          band.display,
        );

/** Apply once at texture load; missing samples and unknown encodings stay intact. */
export function recolorHeightPixels(pixels: Uint8ClampedArray) {
  let changed = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] !== 150) continue;
    const color = colors.get(
      (pixels[offset] << 16) | (pixels[offset + 1] << 8) | pixels[offset + 2],
    );
    if (color) {
      pixels.set(color, offset);
      changed++;
    }
  }
  return changed;
}
