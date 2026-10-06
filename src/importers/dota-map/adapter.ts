import { parseKeyValues, uniqueObject } from "@/importers/keyvalues/parser";
import {
  boundsSchema,
  MAP_LAYERS,
  type MapLayer,
  type MapPoint,
} from "@/domain/map/schema";
export const MAP_IMPORTER_VERSION = "dota-map-1";
export function parseOverview(text: string) {
  const object = uniqueObject(parseKeyValues(text), "dota");
  const fields: Record<string, string> = {};
  for (const { key, value } of object.entries) {
    if (Object.hasOwn(fields, key) || typeof value !== "string")
      throw new Error(`Invalid overview key: ${key}`);
    fields[key] = value;
  }
  for (const key of ["pos_x", "pos_y", "scale"])
    if (!fields[key]?.trim() || !Number.isFinite(Number(fields[key])))
      throw new Error(`Missing/invalid overview ${key}`);
  if (fields.rotate && Number(fields.rotate) !== 0)
    throw new Error("Rotated overview is not supported");
  if (Number(fields.scale) <= 0) throw new Error("Invalid overview scale");
  const x = Number(fields.pos_x),
    y = Number(fields.pos_y),
    span = Number(fields.scale) * 1024;
  return {
    bounds: boundsSchema.parse({
      minX: x,
      maxX: x + span,
      minY: y - span,
      maxY: y,
    }),
    material: fields.material,
    raw: fields,
  };
}
// Exact Source 2 entity classes; never infer object positions from unit definitions.
const CLASSES: Record<string, MapLayer> = {
  npc_dota_fort: "ancient",
  npc_dota_tower: "tower",
  npc_dota_barracks: "barracks",
  npc_dota_neutral_spawner: "camp",
  npc_dota_roshan_spawner: "boss",
  npc_dota_miniboss_spawner: "boss",
  dota_item_rune_spawner: "rune",
  dota_item_rune_spawner_powerup: "rune",
  dota_item_rune_spawner_bounty: "rune",
  dota_item_rune_spawner_xp: "rune",
  ent_dota_shop: "shop",
  npc_dota_watch_tower: "outpost",
  npc_dota_unit_twin_gate: "gate",
  npc_dota_lotus_pool: "lotus",
  ent_dota_tree: "tree",
};
/** Source2Viewer EntityLump.ToEntityDumpString, not arbitrary KV3 or guessed JSON. */
export function parseEntityDump(text: string, sourcePath: string) {
  const sections = text.split(/^====(\d+)====\s*$/m);
  if (sections.length < 3)
    throw new Error(
      "Unsupported entity dump: expected Source2Viewer ====N==== records",
    );
  const points: MapPoint[] = [],
    unknown = new Set<string>(),
    ids = new Set<string>();
  let skipped = 0;
  for (let i = 1; i < sections.length; i += 2) {
    const id = `${sourcePath}:${sections[i]}`;
    if (ids.has(id)) throw new Error(`Duplicate entity ID: ${id}`);
    ids.add(id);
    const props: Record<string, string> = {};
    for (const line of sections[i + 1].split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("@")) continue;
      const match = /^([a-zA-Z0-9_]+)\s+(.+)$/.exec(line);
      if (!match)
        throw new Error(
          `Unsupported entity field in ${id}: ${line.slice(0, 80)}`,
        );
      if (Object.hasOwn(props, match[1]))
        throw new Error(`Duplicate entity field: ${match[1]}`);
      let value = match[2].trim();
      if (value.startsWith('"')) {
        try {
          value = JSON.parse(value);
        } catch {
          throw new Error(`Invalid quoted entity field: ${match[1]}`);
        }
      }
      props[match[1]] = value;
    }
    if (!props.classname) throw new Error(`Missing classname: ${id}`);
    const kind = Object.hasOwn(CLASSES, props.classname)
      ? CLASSES[props.classname]
      : "other";
    if (kind === "other") unknown.add(props.classname);
    // Parent/local transforms need world composition before these can be displayed.
    if (!props.origin || (props.parentname && props.parentname !== "(null)")) {
      skipped++;
      continue;
    }
    const coords = props.origin
      .replace(/[\[\],]/g, " ")
      .trim()
      .split(/\s+/)
      .map(Number);
    if (coords.length !== 3 || !coords.every(Number.isFinite))
      throw new Error(`Invalid origin: ${id}`);
    const teamNumber = props.teamnumber ?? props.runeteam;
    const team =
      teamNumber === "2" ? "radiant" : teamNumber === "3" ? "dire" : "neutral";
    let label =
      props.classname === "npc_dota_roshan_spawner"
        ? "肉山"
        : props.classname === "npc_dota_miniboss_spawner"
          ? "魔方"
          : props.classname === "dota_item_rune_spawner_xp"
            ? "智慧神符"
            : props.classname === "dota_item_rune_spawner_bounty"
              ? "赏金神符"
              : MAP_LAYERS[kind].label;
    if (kind === "camp")
      label =
        (
          {
            "0": "小型野怪营地",
            "1": "中型野怪营地",
            "2": "大型野怪营地",
            "3": "远古营地",
          } as Record<string, string>
        )[props.neutraltype] ?? label;
    if (props.classname === "dota_item_rune_spawner_powerup")
      label = "强化神符";
    const tower =
      /^npc_dota_(?:goodguys|badguys)_tower([1-4])_(top|mid|bot|bottom|left|right)$/.exec(
        props.mapunitname ?? "",
      );
    if (kind === "tower" && tower)
      label = `${({ top: "上路", mid: "中路", bot: "下路", bottom: "下路", left: "左侧", right: "右侧" } as Record<string, string>)[tower[2]]} ${tower[1]}级塔`;
    points.push({
      id,
      label,
      kind,
      x: coords[0],
      y: coords[1],
      z: coords[2],
      team,
      sourceClass: props.classname,
      sourcePath,
      properties: props,
    });
  }
  return { points, skipped, unknownClasses: [...unknown].sort() };
}
