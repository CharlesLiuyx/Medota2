import { expect, it } from "vitest";
import {
  campGold,
  campGroups,
  campExperience,
  groupExperience,
  groupGold,
  laneWave,
} from "@/domain/map/economy";
import { distanceToPath } from "@/domain/map/geometry";
import { economySchema, type MapEconomy } from "@/domain/map/economy-schema";
import { adaptEconomy, lanePaths } from "@/importers/dota-map/economy";
import type { MapPackage } from "@/domain/map/schema";

function fixture(): MapEconomy {
  const units: MapEconomy["units"] = {};
  for (const team of ["goodguys", "badguys"])
    for (const suffix of ["", "_upgraded", "_upgraded_mega"]) {
      for (const kind of ["melee", "flagbearer", "ranged"]) {
        const ranged = kind === "ranged";
        units[`npc_dota_creep_${team}_${kind}${suffix}`] = {
          name: kind,
          min: suffix ? (ranged ? 19 : 20) : ranged ? 43 : 34,
          max: suffix ? (ranged ? 25 : 26) : ranged ? 52 : 39,
          xp: suffix ? (ranged ? 22 : 25) : ranged ? 69 : 57,
          neutralUpgrade: false,
        };
      }
      units[`npc_dota_${team}_siege${suffix}`] = {
        name: "车",
        min: 59,
        max: 72,
        xp: 88,
        neutralUpgrade: false,
      };
    }
  for (const [name, min, max] of [
    ["frog", 17, 19],
    ["grown", 24, 26],
    ["mage", 30, 32],
    ["mud", 28, 34],
    ["shard", 7, 9],
  ] as const)
    units[name] = { name, min, max, xp: min, neutralUpgrade: true };
  return economySchema.parse({
    schemaVersion: 1,
    clientVersion: "6944",
    patch: "7.41f",
    rulesVersion: "creep-economy-7.41-v2",
    units,
    groups: [
      {
        id: "small",
        label: "小",
        tier: 0,
        spawnType: 7,
        members: [{ unit: "frog", count: 3 }],
      },
      {
        id: "medium",
        label: "中",
        tier: 1,
        spawnType: 7,
        members: [
          { unit: "grown", count: 2 },
          { unit: "mage", count: 1 },
        ],
      },
      {
        id: "mud",
        label: "泥",
        tier: 1,
        spawnType: 3,
        members: [{ unit: "mud", count: 2 }],
        children: [{ unit: "shard", count: 4 }],
      },
    ],
    camps: [
      {
        pointId: "a",
        name: "a",
        tier: 0,
        minType: 7,
        maxType: 7,
        forced: -1,
        maxUpgrade: 1,
        stack: [53, 55],
        stackDirection: 0,
        pulls: [],
      },
    ],
    neutralUpgrade: { interval: 450, gold: 1, xp: 5, max: 30 },
    laneUpgrade: { interval: 450, rangedXp: 8 },
    sources: [],
  });
}

it("calculates known waves at flagbearer, upgrade and siege boundaries without adding an extra melee", () => {
  const e = fixture();
  expect(laneWave(e, 0, "normal").total).toEqual({ min: 145, max: 169 });
  expect(laneWave(e, 119, "normal").flag).toBe(0);
  const flag = laneWave(e, 120, "normal");
  expect(flag.rows.reduce((n, r) => n + r.count, 0)).toBe(4);
  expect(flag.total).toEqual({ min: 179, max: 208 });
  expect(laneWave(e, 300, "normal").total).toEqual({ min: 238, max: 280 });
  expect(laneWave(e, 450, "normal").total).toEqual({ min: 151, max: 175 });
  expect(laneWave(e, 900, "normal").melee).toBe(4);
  expect(laneWave(e, 1800, "normal")).toMatchObject({ melee: 5, siege: 2 });
  expect(laneWave(e, 2400, "normal").ranged).toBe(2);
  expect(laneWave(e, 2700, "normal").melee).toBe(6);
  expect(laneWave(e, 3600, "normal").siege).toBe(3);
  expect(laneWave(e, 3630, "normal").siege).toBe(0);
  expect(laneWave(e, 3600, "normal", "dire").total).toEqual(
    laneWave(e, 3600, "normal").total,
  );
  expect(() => laneWave(e, NaN, "normal")).toThrow();
});

it("calculates solo experience across wave, barracks, neutral evolution and split boundaries", () => {
  const e = fixture();
  for (const [time, xp] of [
    [0, 240],
    [120, 240],
    [300, 328],
    [450, 248],
    [900, 401],
    [1800, 562],
    [3600, 872],
  ])
    expect(laneWave(e, time, "normal").xp).toBe(xp);
  expect(laneWave(e, 0, "both").xp).toBe(97);
  expect(laneWave(e, 3600, "mega").xp).toBe(586);
  const mud = e.groups.find((g) => g.id === "mud")!;
  expect(groupExperience(e, mud, 0, false)).toEqual({ min: 56, max: 56 });
  expect(groupExperience(e, mud, 0, true)).toEqual({ min: 84, max: 84 });
  expect(groupExperience(e, mud, 450, true)).toEqual({ min: 114, max: 114 });
  expect(campExperience(e, e.camps[0], 300)).toEqual({ min: 58, max: 64 });
  delete e.units.mud.xp;
  expect(groupExperience(e, mud, 0)).toBeNull();
  expect(() => economySchema.parse(e)).toThrow("Missing experience");
  e.rulesVersion = "creep-economy-7.41-v1";
  delete e.laneUpgrade;
  expect(laneWave(economySchema.parse(e), 0, "normal").xp).toBeNull();
});

it("hits finite lane segments and corners without extending routes past endpoints", () => {
  const vertices = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  expect(distanceToPath({ x: 5, y: 3 }, vertices)).toBe(3);
  expect(distanceToPath({ x: 13, y: 14 }, vertices)).toBe(5);
  expect(distanceToPath({ x: -4, y: 0 }, vertices)).toBe(4);
});

it("keeps each barracks condition independent and separates flagbearer bonus", () => {
  const e = fixture();
  expect(laneWave(e, 0, "melee").total).toEqual({ min: 103, max: 130 });
  expect(laneWave(e, 0, "ranged").total).toEqual({ min: 121, max: 142 });
  expect(laneWave(e, 0, "both").total).toEqual({ min: 79, max: 103 });
  const both = laneWave(e, 1800, "both"),
    mega = laneWave(e, 1800, "mega");
  expect(both.rows.find((r) => r.label === "远程兵")?.direct).toEqual({
    min: 31,
    max: 37,
  });
  expect(mega.rows.find((r) => r.label === "远程兵")?.direct).toEqual({
    min: 19,
    max: 25,
  });
  expect(mega.flagBonus).toEqual({ min: 20, max: 26 });
});

it("enumerates partial flooded evolution and includes optional split creeps in camp ranges", () => {
  const e = fixture(),
    camp = e.camps[0];
  expect(campGold(e, camp, 0)).toEqual({ min: 51, max: 57 });
  expect(campGroups(e, camp, 300)).toHaveLength(2);
  expect(campGold(e, camp, 300)).toEqual({ min: 58, max: 70 });
  expect(
    campGroups(e, camp, 600).every(
      (g) => g.members.reduce((n, m) => n + m.count, 0) === 3,
    ),
  ).toBe(true);
  expect(campGroups(e, camp, 900)[0].id).toBe("medium");
  expect(campGroups(e, camp, 3600)[0].id).toBe("medium");
  const mud = e.groups.find((g) => g.id === "mud")!;
  expect(groupGold(e, mud, 0, false)).toEqual({ min: 56, max: 68 });
  expect(groupGold(e, mud, 0, true)).toEqual({ min: 84, max: 104 });
  expect(groupGold(e, mud, 450, true)).toEqual({ min: 90, max: 110 });
  expect(groupGold(e, mud, 999999, false)).toEqual({ min: 116, max: 128 });
});

it("rejects missing references, duplicate camps and unreviewed versions; resolves XYZ lane waypoints", () => {
  const e = fixture();
  expect(() => economySchema.parse({ ...e, units: {} })).toThrow();
  expect(() =>
    economySchema.parse({ ...e, camps: [...e.camps, ...e.camps] }),
  ).toThrow();
  expect(() =>
    adaptEconomy(
      { provenance: { client_version: "6918" } } as MapPackage,
      "",
      "",
      "",
      "",
    ),
  ).toThrow("only been reviewed");
  const dump =
    '====0====\nclassname "npc_dota_spawner_good_mid"\norigin "1 2 3"\nnpcfirstwaypoint "first"\n====1====\nclassname "path_corner"\ntargetname "first"\norigin "4 5 6"\ntarget "first"\n';
  expect(lanePaths(dump)[0]).toMatchObject({
    team: "radiant",
    lane: "mid",
    vertices: [
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ],
  });
  expect(() =>
    lanePaths(
      dump.replace('npcfirstwaypoint "first"', 'npcfirstwaypoint "missing"'),
    ),
  ).toThrow("Missing lane");
});
