import hullRules from "@/importers/dota-map/hulls-6944.json";
import { parseCurrents } from "@/importers/dota-map/currents";
import { readFile } from "node:fs/promises";
import { insideFile, sha256 } from "@/importers/dota-map/files";
import { parseGridNav } from "@/importers/dota-map/terrain";
import { parseKeyValues } from "@/importers/keyvalues/parser";
import type { MapPackage, MapViewData } from "@/domain/map/schema";
import type { KeyValuesObject } from "@/importers/keyvalues/parser";
import type { RoutingData } from "@/domain/map/routing";

/** Derive only from checksum-bound sources in the selected immutable dataset. */
export async function readRoutingData(
  root: string,
  map: MapPackage,
): Promise<
  RoutingData & {
    watcherRules?: MapViewData["watcherRules"];
    visions?: MapViewData["visions"];
  }
> {
  const source = async (path: string) => {
    const entry = map.provenance.files.find((f) => f.path === path);
    if (!entry) return null;
    const bytes = await readFile(await insideFile(root, `source/${path}`));
    if (sha256(bytes) !== entry.sha256)
      throw new Error(`Navigation source checksum mismatch: ${path}`);
    return bytes;
  };
  const raw = await source("raw/maps/dota.gnv");
  const nav = raw ? parseGridNav(raw) : null;
  const abilities = await source("economy/scripts/npc/npc_abilities.txt");
  let gate: RoutingData["gate"] = null;
  let watcherRules: MapViewData["watcherRules"];
  const obstacles: NonNullable<RoutingData["obstacles"]> = [];
  const hullsSupported =
    map.provenance.client_version === hullRules.client_version &&
    map.provenance.native_source?.map_sha1 === hullRules.map_sha1;
  const visions: NonNullable<MapViewData["visions"]> = {};
  if (abilities) {
    const root = parseKeyValues(abilities.toString("utf8")).entries.find(
      (e) => e.key === "DOTAAbilities",
    )?.value;
    const ability =
      root && typeof root !== "string"
        ? root.entries.find((e) => e.key === "twin_gate_portal_warp")?.value
        : null;
    const watcher =
      root && typeof root !== "string"
        ? root.entries.find((e) => e.key === "ability_lamp_use")?.value
        : null;
    const unitsRaw = await source("economy/scripts/npc/npc_units.txt");
    const units = unitsRaw
      ? parseKeyValues(unitsRaw.toString("utf8")).entries.find(
          (e) => e.key === "DOTAUnits",
        )?.value
      : null;
    if (units && typeof units !== "string") {
      for (const point of map.points ?? []) {
        const unitName =
          point.properties.mapunitname ||
          (point.kind === "watcher"
            ? "npc_dota_lantern"
            : point.kind === "fountain"
              ? "dota_fountain"
              : point.sourceClass);
        const matches = units.entries.filter((e) => e.key === unitName);
        if (matches.length > 1)
          throw new Error(`Duplicate vision unit: ${unitName}`);
        const definition = matches[0]?.value;
        if (!definition || typeof definition === "string") continue;
        const get = (key: string) => {
          const fields = definition.entries.filter((e) => e.key === key);
          if (fields.length > 1)
            throw new Error(`Duplicate vision field: ${unitName}.${key}`);
          const value = fields[0]?.value;
          return typeof value === "string" ? Number(value) : NaN;
        };
        if (hullsSupported) {
          const field = (key: string) =>
            definition.entries.find((e) => e.key === key)?.value;
          const hull = field("BoundsHullName");
          const model = field("Model");
          if (typeof hull === "string") {
            const name = hull.replace("DOTA_HULL_SIZE_", "");
            const radii = hullRules.hulls as Record<string, number>;
            const models = hullRules.models as Record<
              string,
              { radius: number }
            >;
            const estimated = name === "BUILDING";
            const radius =
              estimated && typeof model === "string"
                ? models[model]?.radius
                : radii[name];
            if (radius && radius > 0)
              obstacles.push({
                id: point.id,
                x: point.x,
                y: point.y,
                radius,
                estimated,
              });
          }
        }
        const day = get("VisionDaytimeRange"),
          night = get("VisionNighttimeRange");
        if (
          Number.isFinite(day) &&
          day >= 0 &&
          Number.isFinite(night) &&
          night >= 0 &&
          (day || night)
        )
          visions[point.id] = {
            day,
            night,
            unitName,
            conditional: point.kind === "watcher" ? "激活后" : undefined,
          };
      }
    }
    const unit =
      units && typeof units !== "string"
        ? units.entries.find((e) => e.key === "npc_dota_lantern")?.value
        : null;
    if (
      watcher &&
      typeof watcher !== "string" &&
      unit &&
      typeof unit !== "string"
    ) {
      const values = watcher.entries.find(
        (e) => e.key === "AbilityValues",
      )?.value;
      const num = (object: KeyValuesObject, key: string) => {
        const entries = object.entries.filter((e) => e.key === key);
        const n =
          entries.length === 1 && typeof entries[0].value === "string"
            ? Number(entries[0].value)
            : NaN;
        if (!Number.isFinite(n) || n <= 0)
          throw new Error(`Invalid watcher ${key}`);
        return n;
      };
      if (values && typeof values !== "string")
        watcherRules = {
          channel: num(watcher, "AbilityChannelTime"),
          castRange: num(watcher, "AbilityCastRange"),
          active: num(values, "active_duration"),
          inactive: num(values, "inactive_duration"),
          dayVision: num(unit, "VisionDaytimeRange"),
          nightVision: num(unit, "VisionNighttimeRange"),
        };
    }
    if (ability && typeof ability !== "string") {
      const value = (key: string) => {
        const entries = ability.entries.filter((e) => e.key === key);
        if (entries.length !== 1 || typeof entries[0].value !== "string")
          throw new Error(`Invalid gate ${key}`);
        const n = Number(entries[0].value);
        if (!Number.isFinite(n) || n <= 0)
          throw new Error(`Invalid gate ${key}`);
        return n;
      };
      gate = {
        channel: value("AbilityChannelTime"),
        castRange: value("AbilityCastRange"),
      };
    }
  }
  // Explicit supported rule family; never apply this bonus to an unknown patch.
  const currentPath = "entities/maps/dota/entities/default_ents.vents";
  const currentRaw = /^7\.41[a-z]?$/.test(
    map.provenance.public_source?.patch ?? "",
  )
    ? await source(currentPath)
    : null;
  const currents = currentRaw
    ? parseCurrents(currentRaw.toString("utf8"), currentPath)
    : undefined;
  return {
    currents,
    obstacles,
    grid: nav
      ? {
          cell: nav.cell,
          width: nav.width,
          height: nav.height,
          x: nav.bounds.minX,
          y: nav.bounds.minY,
          // Unknown bits stay blocked; no-ward bit 16 does not block hero movement.
          walkable: Array.from(nav.cells, (f) =>
            f & 1 && !(f & ~21) ? "1" : "0",
          ).join(""),
        }
      : null,
    gate,
    watcherRules,
    visions,
    revision: "static-routing/3-current-projection/1-hulls/1",
  };
}
