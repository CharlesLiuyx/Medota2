import { z } from "zod";
import {
  boundsSchema,
  type MapLayer,
  type MapPoint,
} from "@/domain/map/schema";
const number = z.number().finite();
const point = z.object({ x: number, y: number }).passthrough();
const sourceSchema = z.object({
  source: z.string(),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  counts: z.record(z.string(), z.unknown()),
});
const classes: Record<string, [MapLayer, string]> = {
  ent_dota_tree: ["tree", "树木"],
  ent_dota_fountain: ["fountain", "泉水"],
  ent_dota_shop: ["shop", "商店"],
  npc_dota_fort: ["ancient", "遗迹"],
  npc_dota_watch_tower: ["outpost", "前哨"],
  npc_dota_lantern: ["watcher", "监视者"],
  npc_dota_unit_twin_gate: ["gate", "双生之门"],
  npc_dota_xp_fountain: ["wisdom", "智慧圣坛"],
  npc_dota_lotus_pool: ["lotus", "莲花池"],
  npc_dota_tower: ["tower", "防御塔"],
  npc_dota_barracks: ["barracks", "兵营"],
  npc_dota_neutral_spawner: ["camp", "野怪营地"],
  npc_dota_roshan_spawner: ["boss", "肉山巢穴"],
  npc_dota_miniboss_spawner: ["boss", "魔方位置"],
  dota_item_rune_spawner_bounty: ["rune", "赏金神符"],
  dota_item_rune_spawner_powerup: ["rune", "强化神符"],
  dota_item_rune_spawner_xp: ["rune", "智慧神符"],
  npc_dota_filler: ["other", "基地建筑"],
};
export function parseSloppyMap(
  input: unknown,
  patch: string,
  hash: string,
  manifest: string,
  sourcePath: string,
) {
  const raw = sourceSchema.parse(input);
  // The filename alone cannot establish a version: cross-check the embedded VPK identity.
  const identity =
    /maps\/dota\.vpk of (\d+\.\d+[a-z]?) \(sha1 ([a-f0-9]{40}); Steam depot 373301 manifest (\d+)\)/.exec(
      raw.source,
    );
  if (
    !identity ||
    identity[1] !== patch ||
    identity[2] !== hash ||
    identity[3] !== manifest
  )
    throw new Error("Map patch / VPK hash / Steam manifest disagree");
  const points: MapPoint[] = [],
    zones: {
      id: string;
      label: string;
      kind: "camp";
      vertices: { x: number; y: number }[];
    }[] = [];
  const unknownClasses: string[] = [];
  for (const [sourceClass, rows] of Object.entries(raw.data)) {
    if (raw.counts[sourceClass] !== rows.length)
      throw new Error(`Entity count mismatch: ${sourceClass}`);
    if (sourceClass === "trigger_multiple") {
      for (const [i, row] of rows.entries()) {
        const box = z
          .object({ name: z.string(), points: z.array(point).min(3) })
          .parse(row);
        zones.push({
          id: `camp-zone:${i}`,
          label: box.name,
          kind: "camp",
          vertices: box.points,
        });
      }
      continue;
    }
    if (!classes[sourceClass] && rows.length) unknownClasses.push(sourceClass);
    for (const [i, row] of rows.entries()) {
      const xy = point.parse(row);
      const [kind, name] = classes[sourceClass] ?? ["other", sourceClass];
      let label = name;
      if (kind === "tower" && typeof row.subType === "string")
        label = `${row.subType.replace("tower", "")} 级防御塔`;
      if (kind === "barracks")
        label =
          row.subType === "melee"
            ? "近战兵营"
            : row.subType === "range"
              ? "远程兵营"
              : name;
      if (kind === "camp")
        label = `${({ "0": "小型", "1": "中型", "2": "大型", "3": "远古" } as Record<string, string>)[String(row.neutralType)] ?? "未知类型"}野怪营地`;
      // This source intentionally omits Z and team. Preserve unknowns; do not infer teams from diagonals.
      points.push({
        id: `${sourceClass}:${i}`,
        label,
        kind,
        x: xy.x,
        y: xy.y,
        z: null,
        team: "unknown",
        sourceClass,
        sourcePath,
        properties: Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            typeof value === "string" ? value : JSON.stringify(value),
          ]),
        ),
      });
    }
  }
  if (!points.length) throw new Error("Map has no points");
  return { points, zones, unknownClasses };
}
export function parseSloppyBounds(input: unknown) {
  const m = z
    .object({
      xBounds: z.tuple([number, number]),
      yBounds: z.tuple([number, number]),
      mapW: number.positive(),
      mapH: number.positive(),
      canvasScale: number.positive(),
      crop: z.object({
        x: number,
        y: number,
        w: number.positive(),
        h: number.positive(),
      }),
    })
    .parse(input);
  const x = (px: number) =>
    m.xBounds[0] +
    ((px * m.canvasScale) / m.mapW) * (m.xBounds[1] - m.xBounds[0]);
  const y = (py: number) =>
    m.yBounds[0] +
    ((py * m.canvasScale) / m.mapH) * (m.yBounds[1] - m.yBounds[0]);
  return boundsSchema.parse({
    minX: x(m.crop.x),
    maxX: x(m.crop.x + m.crop.w),
    minY: y(m.crop.y + m.crop.h),
    maxY: y(m.crop.y),
  });
}
