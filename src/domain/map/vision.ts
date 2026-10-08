import type { MapBounds } from "./schema";

export const VISION_ALGORITHM = "approx-ground-vision/1";
/** Simulation choices, not measured Dota constants. */
export const DEFAULT_VISION_OPTIONS = { treeRadius: 64, heightBand: 128 };
export type VisionPosition = { x: number; y: number };
export type VisionSource = VisionPosition & { id: string; radius: number };
export type VisionScene = {
  bounds: MapBounds;
  trees: (VisionPosition & { id: string })[];
  terrain: {
    cell: number;
    width: number;
    height: number;
    origin: VisionPosition;
    /** Row-major, increasing world Y. Null means unavailable, never zero. */
    values: (number | null)[];
  } | null;
};
export type VisionResult =
  | { status: "visible"; sourceId: string }
  | {
      status: "blocked";
      sourceId: string;
      reason: "tree" | "terrain";
      obstacleId?: string;
    }
  | { status: "unknown"; reason: "outside-map" | "missing-height" }
  | { status: "out-of-range" };

const validPosition = (p: VisionPosition) =>
  Number.isFinite(p.x) && Number.isFinite(p.y);
const inside = (p: VisionPosition, b: MapBounds) =>
  p.x >= b.minX && p.x < b.maxX && p.y >= b.minY && p.y < b.maxY;
const distance = (a: VisionPosition, b: VisionPosition) =>
  Math.hypot(a.x - b.x, a.y - b.y);
function validateBounds(b: MapBounds) {
  if (
    ![b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite) ||
    b.maxX <= b.minX ||
    b.maxY <= b.minY
  )
    throw new Error("Invalid vision bounds");
}

/** A prepared snapshot for ONE team's sources. Recreate after any input changes.
 * No Node, DOM or game runtime dependency; future Worker can call the same code.
 */
export function createVisionSolver(
  scene: VisionScene,
  sources: VisionSource[],
  options: Partial<typeof DEFAULT_VISION_OPTIONS> & {
    removedTreeIds?: string[];
  } = {},
) {
  validateBounds(scene.bounds);
  const { treeRadius, heightBand } = { ...DEFAULT_VISION_OPTIONS, ...options };
  if (
    !Number.isFinite(treeRadius) ||
    treeRadius <= 0 ||
    !Number.isFinite(heightBand) ||
    heightBand <= 0
  )
    throw new Error("Invalid vision parameters");
  const treeIds = new Set(scene.trees.map((t) => t.id));
  if (
    treeIds.size !== scene.trees.length ||
    scene.trees.some((t) => !t.id || !validPosition(t))
  )
    throw new Error("Invalid or duplicate vision tree");
  const removed = new Set(options.removedTreeIds ?? []);
  if ([...removed].some((id) => !treeIds.has(id)))
    throw new Error("Unknown removed tree");
  if (
    new Set(sources.map((s) => s.id)).size !== sources.length ||
    sources.some(
      (s) =>
        !s.id ||
        !validPosition(s) ||
        !inside(s, scene.bounds) ||
        !Number.isFinite(s.radius) ||
        s.radius <= 0 ||
        s.radius > 32768,
    )
  )
    throw new Error("Invalid or duplicate vision source");
  const grid = scene.terrain;
  if (
    grid &&
    (!validPosition(grid.origin) ||
      !Number.isFinite(grid.cell) ||
      grid.cell <= 0 ||
      !Number.isInteger(grid.width) ||
      !Number.isInteger(grid.height) ||
      grid.width < 1 ||
      grid.height < 1 ||
      grid.width * grid.height > 1_000_000 ||
      grid.values.length !== grid.width * grid.height ||
      grid.values.some((h) => h !== null && !Number.isFinite(h)))
  )
    throw new Error("Invalid vision terrain");
  const levelAt = (p: VisionPosition): number | null => {
    if (!grid) return null;
    const col = Math.floor((p.x - grid.origin.x) / grid.cell);
    const row = Math.floor((p.y - grid.origin.y) / grid.cell);
    if (col < 0 || row < 0 || col >= grid.width || row >= grid.height)
      return null;
    const value = grid.values[row * grid.width + col];
    return value === null
      ? null
      : Math.floor((value + heightBand / 2) / heightBand);
  };
  const prepared = sources.map((s) => ({
    ...s,
    level: levelAt(s),
    trees: scene.trees.filter((t) => {
      const d = distance(s, t);
      // A source placed inside an approximate tree disk ignores that disk.
      return !removed.has(t.id) && d > treeRadius && d <= s.radius + treeRadius;
    }),
  }));
  const fromSource = (
    s: (typeof prepared)[number],
    target: VisionPosition,
  ): VisionResult => {
    const dx = target.x - s.x,
      dy = target.y - s.y;
    const lengthSquared = dx * dx + dy * dy;
    for (const tree of s.trees) {
      const t =
        lengthSquared === 0
          ? 0
          : Math.max(
              0,
              Math.min(
                1,
                ((tree.x - s.x) * dx + (tree.y - s.y) * dy) / lengthSquared,
              ),
            );
      if (
        Math.hypot(s.x + t * dx - tree.x, s.y + t * dy - tree.y) <= treeRadius
      )
        return {
          status: "blocked",
          sourceId: s.id,
          reason: "tree",
          obstacleId: tree.id,
        };
    }
    if (s.level === null || !grid)
      return { status: "unknown", reason: "missing-height" };
    // Half-cell ray steps are a deliberate approximation, not exact engine FoW.
    const steps = Math.max(
      1,
      Math.ceil(Math.sqrt(lengthSquared) / (grid.cell / 2)),
    );
    let missing = false;
    for (let i = 1; i <= steps; i++) {
      const level = levelAt({
        x: s.x + (dx * i) / steps,
        y: s.y + (dy * i) / steps,
      });
      if (level === null) missing = true;
      else if (level > s.level)
        return { status: "blocked", sourceId: s.id, reason: "terrain" };
    }
    return missing
      ? { status: "unknown", reason: "missing-height" }
      : { status: "visible", sourceId: s.id };
  };
  return (target: VisionPosition): VisionResult => {
    if (!validPosition(target)) throw new Error("Invalid vision target");
    if (!inside(target, scene.bounds))
      return { status: "unknown", reason: "outside-map" };
    let blocked: VisionResult | undefined;
    let unknown: VisionResult | undefined;
    for (const source of prepared) {
      if (distance(source, target) > source.radius) continue;
      const result = fromSource(source, target);
      if (result.status === "visible") return result;
      if (result.status === "unknown") unknown = result;
      else blocked ??= result;
    }
    // An unresolved source may reveal a point blocked from another source.
    return unknown ?? blocked ?? { status: "out-of-range" };
  };
}

export const VISION_CELL_CODES = {
  "out-of-range": 0,
  visible: 1,
  blocked: 2,
  unknown: 3,
} as const;
export function sampleVision(
  solver: ReturnType<typeof createVisionSolver>,
  bounds: MapBounds,
  cell = 64,
) {
  validateBounds(bounds);
  if (!Number.isFinite(cell) || cell <= 0)
    throw new Error("Invalid vision sample size");
  const width = Math.ceil((bounds.maxX - bounds.minX) / cell);
  const height = Math.ceil((bounds.maxY - bounds.minY) / cell);
  if (width * height > 1_000_000) throw new Error("Vision sample too large");
  const cells = new Uint8Array(width * height);
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const target = {
        x:
          (bounds.minX +
            col * cell +
            Math.min(bounds.minX + (col + 1) * cell, bounds.maxX)) /
          2,
        y:
          (bounds.minY +
            row * cell +
            Math.min(bounds.minY + (row + 1) * cell, bounds.maxY)) /
          2,
      };
      cells[row * width + col] = VISION_CELL_CODES[solver(target).status];
    }
  return { algorithm: VISION_ALGORITHM, bounds, cell, width, height, cells };
}
