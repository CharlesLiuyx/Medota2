import type { NavGrid, Position } from "./routing";
export type CurrentSample = Position & { z: number; radius: number };
export type CurrentPath = {
  id: string;
  samples: CurrentSample[];
  maxBonus: number;
};
export type CurrentField = {
  x: Float32Array;
  y: Float32Array;
  bonus: Float32Array;
};
const cache = new WeakMap<NavGrid, WeakMap<CurrentPath[], CurrentField>>();
/** Rasterize only the narrow path corridors, not every cell against every segment. */
export function currentField(
  grid: NavGrid,
  paths: CurrentPath[],
): CurrentField {
  let fields = cache.get(grid);
  if (!fields) {
    fields = new WeakMap();
    cache.set(grid, fields);
  }
  const existing = fields.get(paths);
  if (existing) return existing;
  const n = grid.width * grid.height;
  const field = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    bonus: new Float32Array(n),
  };
  const nearest = new Float32Array(n).fill(Infinity);
  for (const path of paths)
    for (let j = 1; j < path.samples.length; j++) {
      const a = path.samples[j - 1],
        b = path.samples[j],
        dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy);
      if (!length) continue;
      const r = Math.max(a.radius, b.radius);
      const minX = Math.max(
          0,
          Math.floor((Math.min(a.x, b.x) - r - grid.x) / grid.cell),
        ),
        maxX = Math.min(
          grid.width - 1,
          Math.floor((Math.max(a.x, b.x) + r - grid.x) / grid.cell),
        );
      const minY = Math.max(
          0,
          Math.floor((Math.min(a.y, b.y) - r - grid.y) / grid.cell),
        ),
        maxY = Math.min(
          grid.height - 1,
          Math.floor((Math.max(a.y, b.y) + r - grid.y) / grid.cell),
        );
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const i = y * grid.width + x;
          if (grid.walkable[i] !== "1") continue;
          const px = grid.x + (x + 0.5) * grid.cell,
            py = grid.y + (y + 0.5) * grid.cell;
          const t = Math.max(
            0,
            Math.min(
              1,
              ((px - a.x) * dx + (py - a.y) * dy) / (length * length),
            ),
          );
          const distance = Math.hypot(px - a.x - t * dx, py - a.y - t * dy),
            radius = a.radius + (b.radius - a.radius) * t;
          if (distance > radius || distance >= nearest[i]) continue;
          nearest[i] = distance;
          field.x[i] = dx / length;
          field.y[i] = dy / length;
          field.bonus[i] = path.maxBonus;
        }
    }
  fields.set(paths, field);
  return field;
}
/** Explicit estimate: positive directional projection; upstream has no penalty. */
export function flowBonus(
  field: CurrentField,
  index: number,
  dx: number,
  dy: number,
) {
  const length = Math.hypot(dx, dy);
  if (index < 0 || !length) return 0;
  return (
    (field.bonus[index] ?? 0) *
    Math.max(
      0,
      ((field.x[index] ?? 0) * dx + (field.y[index] ?? 0) * dy) / length,
    )
  );
}
