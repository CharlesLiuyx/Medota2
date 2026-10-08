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
  day: number | null;
  night: number | null;
  detection: number | null;
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
export function detectedObservers(
  sources: readonly PlacedVisionSource[],
  teams: readonly string[],
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
              ward.team !== s.team &&
              Math.hypot(ward.x - s.x, ward.y - s.y) <= ward.detection,
          ),
      )
      .map((s) => s.id),
  );
}
