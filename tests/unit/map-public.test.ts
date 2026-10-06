import { expect, it } from "vitest";
import { parseSloppyBounds, parseSloppyMap } from "@/importers/dota-map/sloppy";

const sha = "a".repeat(40),
  manifest = "123456789";
const fixture = {
  source: `game files: maps/dota.vpk of 7.41e (sha1 ${sha}; Steam depot 373301 manifest ${manifest})`,
  data: {
    npc_dota_tower: [
      { x: -3952, y: -6112, subType: "tower3", newKey: "preserved" },
    ],
    npc_dota_lantern: [{ x: 7918, y: -1524 }],
    npc_dota_watch_tower: [{ x: -4096, y: -448 }],
    trigger_multiple: [
      {
        name: "camp",
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
          { x: 5, y: 6 },
        ],
      },
    ],
  },
  counts: {
    npc_dota_tower: 1,
    npc_dota_lantern: 1,
    npc_dota_watch_tower: 1,
    trigger_multiple: 1,
  },
};
it("keeps patch identity exact across filename, manifest and embedded VPK evidence", () => {
  const result = parseSloppyMap(fixture, "7.41e", sha, manifest, "fixture");
  expect(result.points).toHaveLength(3);
  expect(result.points[0]).toMatchObject({
    label: "3 级防御塔",
    z: null,
    team: "unknown",
    properties: { newKey: "preserved" },
  });
  expect(result.points[1].kind).toBe("watcher");
  expect(result.points[2].kind).toBe("outpost");
  expect(result.zones[0].vertices).toHaveLength(3);
  for (const [patch, hash, depotManifest] of [
    ["7.41", sha, manifest],
    ["7.41f", sha, manifest],
    ["7.41e", "b".repeat(40), manifest],
    ["7.41e", sha, "999"],
  ])
    expect(() =>
      parseSloppyMap(fixture, patch, hash, depotManifest, "fixture"),
    ).toThrow("disagree");
  expect(() =>
    parseSloppyMap(
      { ...fixture, counts: { ...fixture.counts, npc_dota_tower: 2 } },
      "7.41e",
      sha,
      manifest,
      "fixture",
    ),
  ).toThrow("count mismatch");
});
it("maps the source crop to world bounds, independently of the native minimap transform", () => {
  const b = parseSloppyBounds({
    xBounds: [-100, 100],
    yBounds: [100, -100],
    mapW: 2000,
    mapH: 2000,
    canvasScale: 2,
    crop: { x: 100, y: 200, w: 800, h: 600 },
  });
  expect(b).toEqual({ minX: -80, maxX: 80, minY: -60, maxY: 60 });
  expect(() => parseSloppyBounds({})).toThrow();
});
