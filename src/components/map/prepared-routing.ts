import { withTrees, type NavGrid } from "@/domain/map/routing";
import type { MapViewData } from "@/domain/map/schema";
const prepared = new WeakMap<object, WeakMap<MapViewData["points"], NavGrid>>();
/** Reuse immutable collision geometry between the route planner and the map painter. */
export function preparedRoutingGrid(
  routing: MapViewData["routing"],
  points: MapViewData["points"],
): NavGrid | null {
  if (!routing?.grid) return null;
  let maps = prepared.get(routing);
  if (!maps) {
    maps = new WeakMap();
    prepared.set(routing, maps);
  }
  let grid = maps.get(points);
  if (!grid) {
    grid = withTrees(
      routing.grid,
      points.filter((point) => point.kind === "tree"),
      routing.obstacles,
    );
    maps.set(points, grid);
  }
  return grid;
}
