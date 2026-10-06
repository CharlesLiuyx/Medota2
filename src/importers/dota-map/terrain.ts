import type { MapBounds } from "@/domain/map/schema";
export function parseGridNav(raw: Buffer) {
  if (raw.length < 32 || raw.readUInt32LE(0) !== 0xfadebead)
    throw new Error("Invalid GNV header");
  const cell = raw.readFloatLE(4),
    width = raw.readUInt32LE(16),
    height = raw.readUInt32LE(20);
  if (
    !Number.isFinite(cell) ||
    cell <= 0 ||
    width < 1 ||
    height < 1 ||
    width * height > 4_000_000 ||
    raw.length !== 32 + width * height
  )
    throw new Error("Invalid GNV dimensions/length");
  const x = raw.readInt32LE(24) * cell,
    y = raw.readInt32LE(28) * cell;
  return {
    cell,
    width,
    height,
    bounds: {
      minX: x,
      maxX: x + cell * width,
      minY: y,
      maxY: y + cell * height,
    },
    cells: raw.subarray(32),
  };
}
export function parseHeightGrid(raw: Buffer) {
  if (
    raw.length < 128 ||
    raw.toString("ascii", 0, 4) !== "vhcg" ||
    raw.readUInt32LE(4) !== 1
  )
    throw new Error("Unsupported VHCG header");
  const cell = raw.readFloatLE(24),
    width = raw.readUInt32LE(12),
    height = raw.readUInt32LE(16),
    samples = raw.readUInt32LE(20),
    x = raw.readFloatLE(28),
    y = raw.readFloatLE(32);
  if (
    ![cell, x, y].every(Number.isFinite) ||
    cell <= 0 ||
    cell !== raw.readUInt32LE(8) ||
    !width ||
    !height ||
    width * height > 4_000_000 ||
    samples < 2 ||
    samples > 33 ||
    raw.length < 128 + width * height * 9
  )
    throw new Error("Invalid VHCG dimensions");
  const offsets = new Int32Array(width * height).fill(-1);
  let end = 128 + width * height * 9;
  for (let i = 0; i < width * height; i++) {
    const offset = 128 + i * 9,
      flag = raw[offset + 8];
    if (
      flag > 1 ||
      ![raw.readFloatLE(offset), raw.readFloatLE(offset + 4)].every(
        Number.isFinite,
      )
    )
      throw new Error("Invalid VHCG record");
    if (flag) {
      offsets[i] = end;
      end += samples * samples * 4;
    }
  }
  if (end !== raw.length) throw new Error("VHCG detail length mismatch");
  const base = 128 + width * height * 9;
  for (let i = base; i < raw.length; i += 4)
    if (!Number.isFinite(raw.readFloatLE(i)))
      throw new Error("Invalid VHCG height");
  const heightAt = (px: number, py: number): number | null => {
    const col = Math.floor((px - x) / cell),
      row = Math.floor((py - y) / cell);
    if (col < 0 || row < 0 || col >= width || row >= height) return null;
    const i = row * width + col;
    let value = raw.readFloatLE(128 + i * 9);
    if (offsets[i] >= 0) {
      // Nearest stored sample; no invented precision or interpolation across cliffs.
      const q = Math.min(
        samples - 1,
        Math.round(((px - x) / cell - col) * (samples - 1)),
      );
      const r = Math.min(
        samples - 1,
        Math.round(((py - y) / cell - row) * (samples - 1)),
      );
      value = raw.readFloatLE(offsets[i] + (r * samples + q) * 4);
    }
    return value <= -16383 ? null : value;
  };
  return { cell, width, height, samples, origin: { x, y }, heightAt };
}
export function terrainPixels(
  nav: ReturnType<typeof parseGridNav>,
  height: ReturnType<typeof parseHeightGrid>,
) {
  const navigation = Buffer.alloc(nav.width * nav.height * 4);
  for (let row = 0; row < nav.height; row++)
    for (let col = 0; col < nav.width; col++) {
      const flag = nav.cells[row * nav.width + col],
        offset = ((nav.height - 1 - row) * nav.width + col) * 4;
      // Community-decoded flags. Unknown bits retain an explicit amber color.
      const color =
        flag & ~21
          ? [245, 180, 65, 150]
          : flag & 16
            ? [226, 91, 183, 140]
            : flag & 1
              ? [75, 190, 142, 65]
              : [75, 85, 110, 150];
      navigation.set(color, offset);
    }
  const step = 32,
    width = Math.ceil((nav.bounds.maxX - nav.bounds.minX) / step),
    rows = Math.ceil((nav.bounds.maxY - nav.bounds.minY) / step);
  if (width * rows > 4_000_000) throw new Error("Height raster too large");
  const elevation = Buffer.alloc(width * rows * 4);
  const colors = [
    [52, 132, 218],
    [88, 170, 72],
    [206, 194, 72],
    [228, 144, 56],
    [214, 84, 62],
    [176, 86, 176],
    [180, 190, 205],
  ];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < width; col++) {
      const value = height.heightAt(
        nav.bounds.minX + (col + 0.5) * step,
        nav.bounds.maxY - (row + 0.5) * step,
      );
      if (value !== null) {
        const color =
          colors[
            Math.max(
              0,
              Math.min(colors.length - 1, Math.floor((value + 64) / 128)),
            )
          ];
        elevation.set([...color, 150], (row * width + col) * 4);
      }
    }
  return {
    navigation,
    elevation,
    width,
    rows,
    bounds: nav.bounds satisfies MapBounds,
  };
}
