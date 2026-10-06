import { parseEntityDump } from "./adapter";
import type { MapPackage, MapPoint } from "@/domain/map/schema";

export function sameSteamInf(a: string, b: string) {
  for (const text of [a, b]) {
    const keys = new Set<string>();
    for (const line of text.replaceAll("\r\n", "\n").split("\n")) {
      if (!line) continue;
      const key = line.split("=")[0];
      if (!line.includes("=") || keys.has(key))
        throw new Error("Invalid/duplicate steam.inf key");
      keys.add(key);
    }
  }
  return a.replaceAll("\r\n", "\n") === b.replaceAll("\r\n", "\n");
}
export function vector(value: string) {
  const parts = value
    .replace(/[\[\],]/g, " ")
    .trim()
    .split(/\s+/)
    .map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite))
    throw new Error("Invalid 3D vector");
  return parts;
}
export function nativeMapEntities(dumps: Map<string, string>) {
  const root = "entities/maps/dota/entities/default_ents.vents";
  const text = dumps.get(root);
  if (!text) throw new Error("Missing standard map root entity lump");
  const main = parseEntityDump(text, root);
  const active = [root],
    inactive: string[] = [];
  for (const record of main.records.filter(
    (r) => r.properties.classname === "info_world_layer",
  )) {
    const layer = record.properties.layername;
    if (!/^world_layer_[a-z0-9_]+$/.test(layer))
      throw new Error("Unsupported world layer name");
    const file = `entities/maps/dota/entities/${layer}.vents`;
    if (!dumps.has(file)) throw new Error(`Missing world layer: ${layer}`);
    const flag = Number(record.properties.spawnflags);
    if (!Number.isInteger(flag) || flag < 0 || flag > 1)
      throw new Error(`Unknown layer spawnflags: ${layer}`);
    (flag & 1 ? active : inactive).push(file);
  }
  if (
    new Set([...active, ...inactive]).size !== dumps.size ||
    active.length + inactive.length !== dumps.size
  )
    throw new Error("Unreferenced or duplicate entity layer");
  const parsed = active.map((p) =>
    p === root ? main : parseEntityDump(dumps.get(p)!, p),
  );
  const points = parsed.flatMap((p) => p.points);
  const hasMarker = (name: string) =>
    points.some(
      (p) =>
        p.sourceClass === "info_player_start_dota" &&
        p.properties.targetname?.includes(name),
    );
  const gameplay: MapPoint[] = [];
  for (const point of points) {
    if (
      point.sourceClass === "npc_dota_roshan_spawner" &&
      hasMarker("roshan_location_")
    )
      continue;
    if (
      point.sourceClass === "npc_dota_miniboss_spawner" &&
      hasMarker("miniboss_location_")
    )
      continue;
    if (point.kind !== "other") gameplay.push(point);
    else if (
      point.sourceClass === "npc_dota_building" &&
      point.properties.mapunitname?.includes("filler")
    )
      gameplay.push({ ...point, label: "基地建筑" });
  }
  return {
    points: gameplay,
    active,
    inactive,
    records: parsed.flatMap((p) => p.records),
    skipped: parsed.reduce((n, p) => n + p.skipped, 0),
    omitted: points.length - gameplay.length,
    unknownClasses: [
      ...new Set(parsed.flatMap((p) => p.unknownClasses)),
    ].sort(),
  };
}
/** Project each PHYS convex hull independently; do not substitute its AABB. */
export function campHulls(
  dump: string,
  props: Record<string, string>,
  id: string,
): MapPackage["zones"] {
  const origin = vector(props.origin),
    angles = vector(props.angles ?? "0 0 0"),
    scales = vector(props.scales ?? "1 1 1");
  if (Math.abs(angles[0]) > 0.001 || Math.abs(angles[2]) > 0.001)
    throw new Error("Tilted camp hull requires 3D projection");
  const yaw = (angles[1] * Math.PI) / 180,
    c = Math.cos(yaw),
    s = Math.sin(yaw);
  const zones: MapPackage["zones"] = [];
  for (const match of dump.matchAll(
    /m_VertexPositions\s*=\s*#\[([\s\S]*?)\]/g,
  )) {
    const hex = match[1].replace(/\s/g, "");
    if (!/^(?:[a-f0-9]{2})+$/i.test(hex) || hex.length % 24)
      throw new Error("Invalid PHYS hull vertices");
    const bytes = Buffer.from(hex, "hex"),
      xy: { x: number; y: number }[] = [];
    const worldVertices: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < bytes.length; i += 12) {
      const x = bytes.readFloatLE(i) * scales[0],
        y = bytes.readFloatLE(i + 4) * scales[1],
        z = bytes.readFloatLE(i + 8);
      if (![x, y, z].every(Number.isFinite))
        throw new Error("Nonfinite hull vertex");
      const p = { x: origin[0] + x * c - y * s, y: origin[1] + x * s + y * c };
      worldVertices.push({ ...p, z: origin[2] + z * scales[2] });
      if (!xy.some((q) => q.x === p.x && q.y === p.y)) xy.push(p);
    }
    xy.sort((a, b) => a.x - b.x || a.y - b.y);
    type XY = { x: number; y: number };
    const cross = (o: XY, a: XY, b: XY) =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const half = (points: XY[]) => {
      const h: XY[] = [];
      for (const p of points) {
        while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0)
          h.pop();
        h.push(p);
      }
      h.pop();
      return h;
    };
    const vertices = [...half(xy), ...half([...xy].reverse())];
    if (vertices.length < 3) throw new Error("Degenerate camp hull");
    zones.push({
      id: `${id}:hull-${zones.length}`,
      label: props.targetname ?? props.volumename ?? "营地生成区域",
      kind: "camp",
      vertices,
      zMin: Math.min(...worldVertices.map((p) => p.z)),
      zMax: Math.max(...worldVertices.map((p) => p.z)),
      worldVertices,
    });
  }
  if (!zones.length) throw new Error(`No PHYS hull: ${id}`);
  return zones;
}
