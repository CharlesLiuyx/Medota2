import { expect, it } from "vitest";
import { parseEntityDump } from "@/importers/dota-map/adapter";
import {
  campHulls,
  nativeMapEntities,
  sameSteamInf,
} from "@/importers/dota-map/native";
import {
  parseGridNav,
  parseHeightGrid,
  terrainPixels,
} from "@/importers/dota-map/terrain";

it("retains multiline and dotted properties, includes initial world layers and keeps destroyed layers separate", () => {
  const root = "entities/maps/dota/entities/default_ents.vents";
  const tree =
    '====0====\nclassname "ent_dota_tree"\norigin [ -100, 200, 128 ]\n';
  const text =
    tree +
    'pathnodes """\n[\n [ 1, 2 ],\n]\n"""\nlocal.angles [ 0, 0, 0 ]\n' +
    '====1====\nclassname "info_world_layer"\nlayername "world_layer_base"\nspawnflags 1\norigin "20 30 0"\n' +
    '====2====\nclassname "info_world_layer"\nlayername "world_layer_destruction"\nspawnflags 0\norigin "20 30 0"\n';
  const dumps = new Map([
    [root, text],
    [
      "entities/maps/dota/entities/world_layer_base.vents",
      tree.replace("-100", "-200"),
    ],
    [
      "entities/maps/dota/entities/world_layer_destruction.vents",
      tree.replace("-100", "-300"),
    ],
  ]);
  const data = nativeMapEntities(dumps);
  expect(data.points.map((p) => p.x)).toEqual([-100, -200]);
  expect(data.points[0].team).toBe("unknown");
  expect(data.points[0].properties.pathnodes).toContain("[ 1, 2 ]");
  expect(data.points[0].properties["local.angles"]).toBe("[ 0, 0, 0 ]");
  expect(data.inactive).toHaveLength(1);
  dumps.delete("entities/maps/dota/entities/world_layer_base.vents");
  expect(() => nativeMapEntities(dumps)).toThrow("Missing world layer");
  expect(() => parseEntityDump(tree + 'pathnodes """\n[', root)).toThrow(
    "Unclosed",
  );
  expect(
    sameSteamInf("ClientVersion=1\r\nX=2\r\n", "ClientVersion=1\nX=2\n"),
  ).toBe(true);
  expect(sameSteamInf("ClientVersion=1\n", "ClientVersion=2\n")).toBe(false);
  expect(() => sameSteamInf("X=1\nX=2\n", "X=1\n")).toThrow("duplicate");
});

it("projects actual convex hull vertices with yaw and scale rather than displaying an unrotated bounds box", () => {
  const vertices = Buffer.alloc(4 * 12);
  [
    [0, 0, 0],
    [2, 0, 0],
    [0, 2, 0],
    [0, 0, 3],
  ].forEach((p, i) =>
    p.forEach((v, j) => vertices.writeFloatLE(v, i * 12 + j * 4)),
  );
  const dump = `m_VertexPositions = #[ ${vertices.toString("hex")} ]`;
  const zones = campHulls(
    dump,
    { origin: "10 20 0", angles: "0 90 0", scales: "2 1 1" },
    "camp",
  );
  expect(zones[0].vertices).toHaveLength(3);
  expect(zones[0].zMin).toBe(0);
  expect(zones[0].zMax).toBe(3);
  expect(zones[0].worldVertices).toHaveLength(4);
  expect(
    zones[0].vertices.map((p) => [Math.round(p.x), Math.round(p.y)]),
  ).toEqual([
    [8, 20],
    [10, 20],
    [10, 24],
  ]);
  expect(() =>
    campHulls(dump, { origin: "0 0 0", angles: "10 0 0" }, "camp"),
  ).toThrow("Tilted");
});

it("decodes native grid geometry, preserves flags and aligns north-up overlays using each grid's own origin", () => {
  const gnv = Buffer.alloc(36);
  gnv.writeUInt32LE(0xfadebead);
  gnv.writeFloatLE(64, 4);
  gnv.writeUInt32LE(2, 16);
  gnv.writeUInt32LE(2, 20);
  gnv.writeInt32LE(-1, 24);
  gnv.writeInt32LE(-1, 28);
  gnv.set([1, 16, 0, 9], 32);
  const nav = parseGridNav(gnv);
  expect(nav.bounds).toEqual({ minX: -64, maxX: 64, minY: -64, maxY: 64 });
  expect([...nav.cells]).toEqual([1, 16, 0, 9]);
  const vhcg = Buffer.alloc(128 + 9 + 4 * 4);
  vhcg.write("vhcg");
  vhcg.writeUInt32LE(1, 4);
  vhcg.writeUInt32LE(128, 8);
  vhcg.writeUInt32LE(1, 12);
  vhcg.writeUInt32LE(1, 16);
  vhcg.writeUInt32LE(2, 20);
  vhcg.writeFloatLE(128, 24);
  vhcg.writeFloatLE(-64, 28);
  vhcg.writeFloatLE(-64, 32);
  vhcg.writeFloatLE(-16384, 128);
  vhcg.writeFloatLE(-16384, 132);
  vhcg[136] = 1;
  [0, 128, 256, 384].forEach((v, i) => vhcg.writeFloatLE(v, 137 + i * 4));
  const height = parseHeightGrid(vhcg);
  expect(height.heightAt(-64, -64)).toBe(0);
  expect(height.heightAt(63, 63)).toBe(384);
  expect(height.heightAt(64, 64)).toBe(null);
  const pixels = terrainPixels(nav, height);
  expect([...pixels.navigation.subarray(0, 4)]).toEqual([75, 85, 110, 150]);
  expect([...pixels.navigation.subarray(4, 8)]).toEqual([245, 180, 65, 150]);
  expect(() => parseGridNav(gnv.subarray(0, 35))).toThrow("length");
  expect(() => parseHeightGrid(vhcg.subarray(0, -1))).toThrow("length");
});
