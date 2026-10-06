import type { MapBounds, MapPoint } from "./schema";
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export function fitScale(b: MapBounds, width: number, height: number) {
  return Math.min(width / (b.maxX - b.minX), height / (b.maxY - b.minY)) * 0.96;
}
export function toScreen(
  x: number,
  y: number,
  camera: Camera,
  scale: number,
  width: number,
  height: number,
) {
  return {
    x: width / 2 + (x - camera.x) * scale * camera.zoom,
    y: height / 2 - (y - camera.y) * scale * camera.zoom,
  };
}
export function toWorld(
  x: number,
  y: number,
  camera: Camera,
  scale: number,
  width: number,
  height: number,
) {
  return {
    x: camera.x + (x - width / 2) / (scale * camera.zoom),
    y: camera.y - (y - height / 2) / (scale * camera.zoom),
  };
}
export function zoomAt(
  camera: Camera,
  factor: number,
  x: number,
  y: number,
  scale: number,
  width: number,
  height: number,
): Camera {
  const before = toWorld(x, y, camera, scale, width, height);
  const zoom = Math.max(1, Math.min(16, camera.zoom * factor));
  const after = toWorld(x, y, { ...camera, zoom }, scale, width, height);
  return {
    x: camera.x + before.x - after.x,
    y: camera.y + before.y - after.y,
    zoom,
  };
}
/** Fixed spatial bins keep pointer hit tests local even with thousands of trees. */
export function pointIndex(points: MapPoint[], cell = 512) {
  const bins = new Map<string, MapPoint[]>();
  for (const p of points) {
    const key = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
    const bin = bins.get(key) ?? [];
    bin.push(p);
    bins.set(key, bin);
  }
  return (x: number, y: number, radius: number) => {
    const nearby: MapPoint[] = [];
    for (
      let bx = Math.floor((x - radius) / cell);
      bx <= Math.floor((x + radius) / cell);
      bx++
    )
      for (
        let by = Math.floor((y - radius) / cell);
        by <= Math.floor((y + radius) / cell);
        by++
      )
        for (const p of bins.get(`${bx},${by}`) ?? [])
          if (Math.hypot(p.x - x, p.y - y) <= radius) nearby.push(p);
    return nearby;
  };
}

/** Distance to the finite path segments, including repeated vertices and endpoints. */
export function distanceToPath(
  point: { x: number; y: number },
  vertices: readonly { x: number; y: number }[],
) {
  let closest = Infinity;
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1],
      b = vertices[i],
      dx = b.x - a.x,
      dy = b.y - a.y;
    const length = dx * dx + dy * dy;
    const t = length
      ? Math.max(
          0,
          Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length),
        )
      : 0;
    closest = Math.min(
      closest,
      Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy),
    );
  }
  return closest;
}
