import type { NavGrid } from "./routing";
import type { MapBounds } from "./schema";
import type { VisionPosition } from "./vision";

/** Placement cells share the coverage raster's origin and edge-cell centers. */
export const VISION_SOURCE_CELL = 64;
export type VisionPreset = {
  key: string;
  kind: "observer" | "sentry" | "hero";
  zhName: string;
  enName: string;
  imageUrl: string | null;
  imageAnchor?: readonly [number, number];
  day: number | null;
  night: number | null;
  detection: number | null;
  /** Hero's initial movement speed from this Catalog, before buffs or items. */
  baseMovementSpeed?: number | null;
  /** Version-bound engine hull radius, including its movement padding. */
  collisionRadius?: number | null;
};
export type PlacedVisionSource = VisionPosition & {
  id: string;
  team: "radiant" | "dire";
  kind: VisionPreset["kind"] | "custom";
  presetKey: string;
  day: number;
  night: number;
  detection: number;
};

/** Rasterize the version-bound hull onto placement cells, excluding mere tangency. */
export function heroVisionFootprint(
  position: VisionPosition,
  radius: number | null | undefined,
  gridBounds: MapBounds,
) {
  if (radius == null || !Number.isFinite(radius) || radius <= 0) return null;
  const cell = VISION_SOURCE_CELL;
  const bounds = {
    minX:
      gridBounds.minX +
      Math.floor((position.x - radius - gridBounds.minX) / cell) * cell,
    maxX:
      gridBounds.minX +
      Math.ceil((position.x + radius - gridBounds.minX) / cell) * cell,
    minY:
      gridBounds.minY +
      Math.floor((position.y - radius - gridBounds.minY) / cell) * cell,
    maxY:
      gridBounds.minY +
      Math.ceil((position.y + radius - gridBounds.minY) / cell) * cell,
  };
  const cells: MapBounds[] = [];
  for (let y = bounds.minY; y < bounds.maxY; y += cell)
    for (let x = bounds.minX; x < bounds.maxX; x += cell) {
      const dx = Math.max(x - position.x, 0, position.x - x - cell);
      const dy = Math.max(y - position.y, 0, position.y - y - cell);
      if (dx * dx + dy * dy < radius * radius)
        cells.push({ minX: x, minY: y, maxX: x + cell, maxY: y + cell });
    }
  return { bounds, cells };
}

export function snapVisionPosition(
  position: VisionPosition,
  bounds: MapBounds,
  gridBounds: MapBounds = bounds,
) {
  const snap = (value: number, min: number, max: number, origin: number) => {
    if (gridBounds !== bounds) {
      const first = Math.ceil((min - origin) / VISION_SOURCE_CELL - 0.5);
      const last = Math.floor((max - origin) / VISION_SOURCE_CELL - 0.5);
      const index = Math.max(
        first,
        Math.min(last, Math.floor((value - origin) / VISION_SOURCE_CELL)),
      );
      return first <= last
        ? origin + (index + 0.5) * VISION_SOURCE_CELL
        : (min + max) / 2;
    }
    const start =
      min +
      Math.floor(
        (Math.max(min, Math.min(max - 0.001, value)) - min) /
          VISION_SOURCE_CELL,
      ) *
        VISION_SOURCE_CELL;
    return (start + Math.min(start + VISION_SOURCE_CELL, max)) / 2;
  };
  return {
    x: snap(position.x, bounds.minX, bounds.maxX, gridBounds.minX),
    y: snap(position.y, bounds.minY, bounds.maxY, gridBounds.minY),
  };
}

/** Range membership only: no claim that True Sight supplies ground vision. */
export function observersInSentryRange(
  sources: readonly PlacedVisionSource[],
  teams: readonly string[],
  enemiesOnly = false,
) {
  const sentries = sources.filter(
    (s) => s.kind === "sentry" && teams.includes(s.team),
  );
  return new Set(
    sources
      .filter(
        (s) =>
          s.kind === "observer" &&
          sentries.some(
            (ward) =>
              (!enemiesOnly || ward.team !== s.team) &&
              Math.hypot(ward.x - s.x, ward.y - s.y) <= ward.detection,
          ),
      )
      .map((s) => s.id),
  );
}

/** Opposing-team subset used to expose enemies within the displayed team's sentries. */
export function detectedObservers(
  sources: readonly PlacedVisionSource[],
  teams: readonly string[],
) {
  return observersInSentryRange(sources, teams, true);
}

/** Validate the snapped native cell, without treating elevation as a placement rule. */
export function visionPlacementIssue(
  position: VisionPosition,
  bounds: MapBounds,
  grid: NavGrid | null | undefined,
  kind: PlacedVisionSource["kind"],
): "outside" | "no-ward" | "unknown" | "blocked" | null {
  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    position.x < bounds.minX ||
    position.x >= bounds.maxX ||
    position.y < bounds.minY ||
    position.y >= bounds.maxY
  )
    return "outside";
  if (!grid) return null;
  const col = Math.floor((position.x - grid.x) / grid.cell);
  const row = Math.floor((position.y - grid.y) / grid.cell);
  if (col < 0 || col >= grid.width || row < 0 || row >= grid.height)
    return "outside";
  const index = row * grid.width + col;
  if (grid.noWard?.[index] === "1") return "no-ward";
  if (grid.wardable !== undefined && grid.wardable[index] !== "1")
    return "unknown";
  if (kind === "hero" && grid.walkable[index] !== "1") return "blocked";
  return null;
}
