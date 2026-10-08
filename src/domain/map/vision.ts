import type { MapBounds } from "./schema";

/** Shared with server preparation and persistent caches; bump when scene interpretation changes. */
export const VISION_SCENE_FORMAT = "vision-scene/3";
export const VISION_ALGORITHM = "approx-ground-vision/2";
/** Simulation choices, not measured Dota constants. */
export const DEFAULT_VISION_OPTIONS = {
  treeRadius: 64,
  heightBand: 128,
  treeHeight: 128,
};
export type VisionPosition = { x: number; y: number };
export type VisionSource = VisionPosition & {
  id: string;
  radius: number;
  z?: number;
};
export type VisionScene = {
  bounds: MapBounds;
  trees: (VisionPosition & { id: string; z?: number | null })[];
  terrain: {
    cell: number;
    width: number;
    height: number;
    origin: VisionPosition;
    /** Row-major, increasing world Y. Null means unavailable, never zero. */
    values: (number | null)[];
    /** Sparse 2×2 samples at native tile seams; prevents shifting a discontinuity
     * by half a sample. Order: lower-left, lower-right, upper-left, upper-right. */
    subcells?: Record<number, (number | null)[]>;
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

/** Ground Z from the selected scene. The server preserves native nearest-sample
 * cells; absence is unknown, never sea level. */
export function visionGroundZ(
  scene: VisionScene,
  p: VisionPosition,
): number | null {
  const grid = scene.terrain;
  if (!grid || !inside(p, scene.bounds)) return null;
  const col = Math.floor((p.x - grid.origin.x) / grid.cell);
  const row = Math.floor((p.y - grid.origin.y) / grid.cell);
  if (col < 0 || row < 0 || col >= grid.width || row >= grid.height)
    return null;
  const split = grid.subcells?.[row * grid.width + col];
  if (split) {
    const qx = p.x >= grid.origin.x + (col + 0.5) * grid.cell ? 1 : 0;
    const qy = p.y >= grid.origin.y + (row + 0.5) * grid.cell ? 1 : 0;
    return split[qy * 2 + qx];
  }
  return grid.values[row * grid.width + col];
}

/** A prepared snapshot for ONE team's sources. Recreate after any input changes.
 * No Node, DOM or game runtime dependency; Worker and offline sampling share the same code.
 */
export function createVisionSolver(
  scene: VisionScene,
  sources: VisionSource[],
  options: Partial<typeof DEFAULT_VISION_OPTIONS> & {
    removedTreeIds?: string[];
  } = {},
) {
  return buildVisionSolver(scene, sources, options, true);
}

type PreparedScene = {
  treeIds: Set<string>;
  trees: Map<string, (VisionScene["trees"][number] & { top: number | null })[]>;
};

function validateVisionInput(
  scene: VisionScene,
  sources: VisionSource[],
  options: Partial<typeof DEFAULT_VISION_OPTIONS> & {
    removedTreeIds?: string[];
  },
  validate: boolean,
  staticScene?: PreparedScene,
) {
  validateBounds(scene.bounds);
  const { treeRadius, heightBand, treeHeight } = {
    ...DEFAULT_VISION_OPTIONS,
    ...options,
  };
  if (
    !Number.isFinite(treeRadius) ||
    treeRadius <= 0 ||
    !Number.isFinite(heightBand) ||
    heightBand <= 0 ||
    !Number.isFinite(treeHeight) ||
    treeHeight <= 0
  )
    throw new Error("Invalid vision parameters");
  const treeIds = staticScene?.treeIds ?? new Set(scene.trees.map((t) => t.id));
  if (
    validate &&
    (treeIds.size !== scene.trees.length ||
      scene.trees.some(
        (t) =>
          !t.id || !validPosition(t) || (t.z != null && !Number.isFinite(t.z)),
      ))
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
        (s.z !== undefined && !Number.isFinite(s.z)) ||
        !Number.isFinite(s.radius) ||
        s.radius <= 0 ||
        s.radius > 32768,
    )
  )
    throw new Error("Invalid or duplicate vision source");
  const grid = scene.terrain;
  if (
    validate &&
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
      grid.values.some((h) => h !== null && !Number.isFinite(h)) ||
      Object.entries(grid.subcells ?? {}).some(
        ([key, values]) =>
          !Number.isInteger(Number(key)) ||
          Number(key) < 0 ||
          Number(key) >= grid.width * grid.height ||
          values.length !== 4 ||
          values.some((z) => z !== null && !Number.isFinite(z)),
      ))
  )
    throw new Error("Invalid vision terrain");
  return { treeRadius, heightBand, treeHeight, grid, removed };
}

function buildVisionSolver(
  scene: VisionScene,
  sources: VisionSource[],
  options: Partial<typeof DEFAULT_VISION_OPTIONS> & {
    removedTreeIds?: string[];
  },
  validate: boolean,
  staticScene?: PreparedScene,
) {
  const { treeRadius, heightBand, treeHeight, grid, removed } =
    validateVisionInput(scene, sources, options, validate, staticScene);
  const levelOf = (z: number) => Math.floor((z + heightBand / 2) / heightBand);
  const staticKey = `${heightBand}:${treeHeight}`;
  const trees =
    staticScene?.trees.get(staticKey) ??
    scene.trees.map((tree) => {
      const z = tree.z ?? visionGroundZ(scene, tree);
      return {
        ...tree,
        top: z === null ? null : levelOf(z) * heightBand + treeHeight,
      };
    });
  staticScene?.trees.set(staticKey, trees);
  const prepared = sources.map((s) => {
    const z = s.z ?? visionGroundZ(scene, s);
    const level = z === null ? null : levelOf(z);
    return {
      ...s,
      level,
      trees: trees.filter((t) => {
        const d = distance(s, t);
        // Effective FoW tree height, not visual model height: a source on a
        // higher layer can see over lower trees. Unknown Z cannot prove blockage.
        return (
          !removed.has(t.id) &&
          d > treeRadius &&
          d <= s.radius + treeRadius &&
          (level === null || t.top === null || t.top > level * heightBand)
        );
      }),
    };
  });
  const fromSource = (
    s: (typeof prepared)[number],
    target: VisionPosition,
  ): VisionResult => {
    const dx = target.x - s.x,
      dy = target.y - s.y;
    const lengthSquared = dx * dx + dy * dy;
    let missing = s.level === null;
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
      ) {
        if (s.level === null || tree.top === null) missing = true;
        else
          return {
            status: "blocked",
            sourceId: s.id,
            reason: "tree",
            obstacleId: tree.id,
          };
      }
    }
    if (s.level === null || !grid)
      return { status: "unknown", reason: "missing-height" };
    // Visit every height cell crossed by the segment. Fixed-distance ray steps
    // can skip a narrow corner of a cliff even at half-cell spacing.
    let col = Math.floor((s.x - grid.origin.x) / grid.cell);
    let row = Math.floor((s.y - grid.origin.y) / grid.cell);
    const endCol = Math.floor((target.x - grid.origin.x) / grid.cell);
    const endRow = Math.floor((target.y - grid.origin.y) / grid.cell);
    const stepX = Math.sign(dx),
      stepY = Math.sign(dy);
    const deltaX = dx === 0 ? Infinity : grid.cell / Math.abs(dx);
    const deltaY = dy === 0 ? Infinity : grid.cell / Math.abs(dy);
    let nextX =
      dx === 0
        ? Infinity
        : (grid.origin.x + (col + (stepX > 0 ? 1 : 0)) * grid.cell - s.x) / dx;
    let nextY =
      dy === 0
        ? Infinity
        : (grid.origin.y + (row + (stepY > 0 ? 1 : 0)) * grid.cell - s.y) / dy;
    const checkHeight = (z: number | null) => {
      if (z === null) {
        missing = true;
        return false;
      }
      return levelOf(z) > s.level!;
    };
    const checkCell = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= grid.width || y >= grid.height)
        return checkHeight(null);
      const split = grid.subcells?.[y * grid.width + x];
      if (!split) return checkHeight(grid.values[y * grid.width + x]);
      for (let q = 0; q < 4; q++) {
        const minX = grid.origin.x + (x + (q % 2) / 2) * grid.cell;
        const minY = grid.origin.y + (y + Math.floor(q / 2) / 2) * grid.cell;
        const maxX = minX + grid.cell / 2,
          maxY = minY + grid.cell / 2;
        // Slab intersection restricts Z checks to subcells actually crossed.
        let entry = 0,
          exit = 1;
        if (dx === 0) {
          if (s.x < minX || s.x >= maxX) continue;
        } else {
          const a = (minX - s.x) / dx,
            b = (maxX - s.x) / dx;
          entry = Math.max(entry, Math.min(a, b));
          exit = Math.min(exit, Math.max(a, b));
        }
        if (dy === 0) {
          if (s.y < minY || s.y >= maxY) continue;
        } else {
          const a = (minY - s.y) / dy,
            b = (maxY - s.y) / dy;
          entry = Math.max(entry, Math.min(a, b));
          exit = Math.min(exit, Math.max(a, b));
        }
        if (entry <= exit && checkHeight(split[q])) return true;
      }
      return false;
    };
    const maxCells = Math.abs(endCol - col) + Math.abs(endRow - row) + 1;
    for (let visited = 0; visited < maxCells; visited++) {
      if (checkCell(col, row))
        return { status: "blocked", sourceId: s.id, reason: "terrain" };
      if (col === endCol && row === endRow) break;
      if (nextX < nextY) {
        col += stepX;
        nextX += deltaX;
      } else if (nextY < nextX) {
        row += stepY;
        nextY += deltaY;
      } else {
        // A corner touching two high cells is blocked conservatively.
        if (checkCell(col + stepX, row) || checkCell(col, row + stepY))
          return { status: "blocked", sourceId: s.id, reason: "terrain" };
        col += stepX;
        row += stepY;
        nextX += deltaX;
        nextY += deltaY;
      }
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

export type VisionSamples = ReturnType<typeof sampleVision> & {
  /** Work performed by this calculation, excluding cached source tiles. */
  work?: { sampledCells: number; reusedSources: number };
  extent?: { col: number; row: number; endCol: number; endRow: number } | null;
};
export type VisionRequest = {
  sources: VisionSource[];
  options: Partial<typeof DEFAULT_VISION_OPTIONS> & {
    removedTreeIds?: string[];
  };
};
type VisionControl = { signal: AbortSignal; onProgress(value: number): void };
export type VisionDefaultTile = {
  col: number;
  row: number;
  width: number;
  height: number;
  cells: Uint8Array;
  /** First blocking tree index + 1; -1 means unknown, 0 needs no tree delta. */
  blockers: Int32Array;
};

/** Optional storage of reproducible default tiles, namespaced by the caller's
 * scene revision and algorithm. Missing/corrupt storage never prevents sampling. */
export type VisionTileStore = {
  get(key: string): Promise<unknown>;
  put(key: string, tile: VisionDefaultTile): void;
};

/** Prepare the immutable map once. Cache default coverage independently of IDs
 * and removed trees, then revisit only cells affected by the current tree delta. */
export function createVisionSampler(
  scene: VisionScene,
  store?: VisionTileStore,
) {
  const prepared: PreparedScene = {
    treeIds: new Set(scene.trees.map((t) => t.id)),
    trees: new Map(),
  };
  buildVisionSolver(scene, [], {}, true, prepared);
  const treeIndices = new Map(scene.trees.map((t, index) => [t.id, index + 1]));
  const tiles = new Map<string, VisionDefaultTile>();
  let bytes = 0;
  const remember = (key: string, tile: VisionDefaultTile) => {
    const old = tiles.get(key);
    if (old) bytes -= old.cells.byteLength + old.blockers.byteLength;
    tiles.delete(key);
    tiles.set(key, tile);
    bytes += tile.cells.byteLength + tile.blockers.byteLength;
    while (bytes > 16 * 1024 * 1024 && tiles.size > 1) {
      const first = tiles.keys().next().value!;
      const value = tiles.get(first)!;
      bytes -= value.cells.byteLength + value.blockers.byteLength;
      tiles.delete(first);
    }
  };
  return async (
    request: VisionRequest,
    control: VisionControl,
  ): Promise<VisionSamples> => {
    validateVisionInput(
      scene,
      request.sources,
      request.options,
      false,
      prepared,
    );
    const bounds = scene.bounds,
      cell = 64;
    const width = Math.ceil((bounds.maxX - bounds.minX) / cell);
    const height = Math.ceil((bounds.maxY - bounds.minY) / cell);
    if (width * height > 1_000_000) throw new Error("Vision sample too large");
    const cells = new Uint8Array(width * height);
    const work = { sampledCells: 0, reusedSources: 0 };
    let extent: VisionSamples["extent"] = null;
    const priority = [0, 3, 1, 2];
    const options = {
      ...DEFAULT_VISION_OPTIONS,
      ...request.options,
      removedTreeIds: [] as string[],
    };
    const removed = new Set(
      (request.options.removedTreeIds ?? []).map((id) => treeIndices.get(id)!),
    );
    let deadline = performance.now() + 8;
    const check = () => {
      if (control.signal.aborted)
        throw new DOMException("Vision cancelled", "AbortError");
    };
    for (const [sourceIndex, source] of request.sources.entries()) {
      check();
      const key = JSON.stringify([
        source.x,
        source.y,
        source.z ?? null,
        source.radius,
        options.treeRadius,
        options.heightBand,
        options.treeHeight,
      ]);
      const col = Math.max(
        0,
        Math.floor((source.x - source.radius - bounds.minX) / cell),
      );
      const row = Math.max(
        0,
        Math.floor((source.y - source.radius - bounds.minY) / cell),
      );
      const endCol = Math.min(
        width - 1,
        Math.floor((source.x + source.radius - bounds.minX) / cell),
      );
      const endRow = Math.min(
        height - 1,
        Math.floor((source.y + source.radius - bounds.minY) / cell),
      );
      extent = extent
        ? {
            col: Math.min(extent.col, col),
            row: Math.min(extent.row, row),
            endCol: Math.max(extent.endCol, endCol),
            endRow: Math.max(extent.endRow, endRow),
          }
        : { col, row, endCol, endRow };
      const tw = endCol - col + 1,
        th = endRow - row + 1;
      let tile = tiles.get(key);
      if (!tile && store) {
        const value = (await store
          .get(key)
          .catch(() => null)) as VisionDefaultTile | null;
        check();
        if (
          value &&
          value.col === col &&
          value.row === row &&
          value.width === tw &&
          value.height === th &&
          value.cells instanceof Uint8Array &&
          value.cells.length === tw * th &&
          value.blockers instanceof Int32Array &&
          value.blockers.length === tw * th &&
          value.cells.every(
            (code, i) =>
              code <= 3 &&
              (code === 3
                ? value.blockers[i] === -1
                : code === 2
                  ? value.blockers[i] >= 0 &&
                    value.blockers[i] <= scene.trees.length
                  : value.blockers[i] === 0),
          )
        )
          tile = value;
      }
      if (tile) {
        remember(key, tile);
        work.reusedSources++;
      } else {
        tile = {
          col,
          row,
          width: tw,
          height: th,
          cells: new Uint8Array(tw * th),
          blockers: new Int32Array(tw * th),
        };
        const solver = buildVisionSolver(
          scene,
          [source],
          options,
          false,
          prepared,
        );
        for (let i = 0; i < tile.cells.length; i++) {
          const x = bounds.minX + (col + (i % tw)) * cell;
          const y = bounds.minY + (row + Math.floor(i / tw)) * cell;
          const result = solver({
            x: (x + Math.min(x + cell, bounds.maxX)) / 2,
            y: (y + Math.min(y + cell, bounds.maxY)) / 2,
          });
          tile.cells[i] = VISION_CELL_CODES[result.status];
          tile.blockers[i] =
            result.status === "unknown"
              ? -1
              : result.status === "blocked" && result.obstacleId
                ? treeIndices.get(result.obstacleId)!
                : 0;
          work.sampledCells++;
          if (i % 64 === 0 && performance.now() >= deadline) {
            check();
            control.onProgress(
              (sourceIndex + i / tile.cells.length) / request.sources.length,
            );
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            deadline = performance.now() + 8;
          }
        }
        check();
        remember(key, tile);
        store?.put(key, tile);
      }
      const solver = removed.size
        ? buildVisionSolver(scene, [source], request.options, false, prepared)
        : null;
      for (let i = 0; i < tile.cells.length; i++) {
        const target =
          (tile.row + Math.floor(i / tile.width)) * width +
          tile.col +
          (i % tile.width);
        let code = tile.cells[i];
        if (
          solver &&
          (removed.has(tile.blockers[i]) || tile.blockers[i] === -1)
        ) {
          const x = bounds.minX + (tile.col + (i % tile.width)) * cell;
          const y =
            bounds.minY + (tile.row + Math.floor(i / tile.width)) * cell;
          code =
            VISION_CELL_CODES[
              solver({
                x: (x + Math.min(x + cell, bounds.maxX)) / 2,
                y: (y + Math.min(y + cell, bounds.maxY)) / 2,
              }).status
            ];
          work.sampledCells++;
        }
        if (priority[code] > priority[cells[target]]) cells[target] = code;
        if (i % 64 === 0 && performance.now() >= deadline) {
          check();
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          deadline = performance.now() + 8;
        }
      }
    }
    check();
    control.onProgress(1);
    return {
      algorithm: VISION_ALGORITHM,
      bounds,
      cell,
      width,
      height,
      cells,
      work,
      extent,
    };
  };
}
export function sampleVisionAsync(
  scene: VisionScene,
  request: VisionRequest,
  control: VisionControl,
) {
  return createVisionSampler(scene)(request, control);
}
