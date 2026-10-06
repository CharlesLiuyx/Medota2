import { describe, expect, it } from "vitest";
import { parseEntityDump, parseOverview } from "@/importers/dota-map/adapter";
import {
  fitScale,
  pointIndex,
  toScreen,
  toWorld,
  zoomAt,
} from "@/domain/map/geometry";
import { mapPackageSchema, type MapPoint } from "@/domain/map/schema";
const overview =
  "dota { material materials/overviews/dota.vmat pos_x -9472 pos_y 9472 scale 18.5 }";
const dump =
  '====0====\nclassname "npc_dota_tower"\norigin "-6400 -5900 256"\nteamnumber 2\ncustom_key "preserve me"\n\n====1====\nclassname "dota_item_rune_spawner_xp"\norigin "4200 6100 128"\n';
describe("map source and coordinates", () => {
  it("maps native overview corners and inverts screen Y without depending on image resolution", () => {
    const { bounds } = parseOverview(overview);
    expect(bounds).toEqual({
      minX: -9472,
      maxX: 9472,
      minY: -9472,
      maxY: 9472,
    });
    const camera = { x: 0, y: 0, zoom: 1 },
      scale = fitScale(bounds, 1000, 1000);
    expect(toScreen(-9472, 9472, camera, scale, 1000, 1000)).toEqual({
      x: 20,
      y: 20,
    });
    expect(toWorld(980, 980, camera, scale, 1000, 1000)).toEqual({
      x: 9472,
      y: -9472,
    });
    const before = toWorld(321, 765, camera, scale, 1000, 1000);
    const zoomed = zoomAt(camera, 4, 321, 765, scale, 1000, 1000);
    expect(toWorld(321, 765, zoomed, scale, 1000, 1000)).toEqual(before);
    expect(zoomAt(camera, 100, 0, 0, scale, 1000, 1000).zoom).toBe(16);
  });
  it("preserves unknown fields, classifies exact classes and excludes unresolved parent transforms", () => {
    const result = parseEntityDump(
      dump +
        '\n====2====\nclassname "ent_dota_tree"\norigin "1 2 3"\nparentname "template"\n',
      "root.vents",
    );
    expect(result.points).toHaveLength(2);
    expect(result.points[0]).toMatchObject({
      kind: "tower",
      x: -6400,
      y: -5900,
      z: 256,
      team: "radiant",
      properties: { custom_key: "preserve me" },
    });
    expect(result.points[1].label).toBe("智慧神符");
    expect(result.skipped).toBe(1);
    expect(
      parseEntityDump(
        '====0====\nclassname "npc_dota_watch_tower"\norigin "0 0 0"',
        "root",
      ).points[0],
    ).toMatchObject({ kind: "outpost", label: "前哨" });
    expect(
      parseEntityDump(
        '====0====\nclassname "new_class"\norigin "0 0 0"',
        "root.vents",
      ).unknownClasses,
    ).toEqual(["new_class"]);
  });
  it("rejects missing, duplicate and incompatible source fields", () => {
    expect(() => parseOverview("dota { pos_x 0 pos_y 0 }")).toThrow();
    expect(() =>
      parseOverview(overview.replace("scale 18.5", "scale 18.5 rotate 1")),
    ).toThrow("Rotated");
    expect(() =>
      parseOverview(overview.replace("scale 18.5", "scale 18.5 scale 1")),
    ).toThrow("Invalid overview key");
    expect(() =>
      parseEntityDump(dump.replace('"-6400 -5900 256"', '"oops"'), "root"),
    ).toThrow("origin");
    expect(() =>
      parseEntityDump(dump.replace("====1====", "====0===="), "root"),
    ).toThrow("Duplicate");
    expect(() => parseEntityDump('{ "classname": "tree" }', "root")).toThrow(
      "Unsupported",
    );
  });
  it("keeps hit testing spatial and correct across negative cell boundaries", () => {
    const p = parseEntityDump(dump, "root").points[0];
    const points: MapPoint[] = Array.from({ length: 10000 }, (_, i) => ({
      ...p,
      id: String(i),
      x: (i % 100) * 128 - 6400,
      y: Math.floor(i / 100) * 128 - 6400,
    }));
    const query = pointIndex(points);
    expect(query(-512, -512, 1)).toHaveLength(1);
    expect(query(-512, -512, 129)).toHaveLength(5);
    expect(query(99999, 99999, 1)).toHaveLength(0);
  });
  it("rejects duplicate identity and out-of-bounds points before publication", () => {
    const p = parseEntityDump(dump, "root").points[0];
    const sample = {
      schemaVersion: 1,
      mapName: "dota",
      bounds: parseOverview(overview).bounds,
      image: {
        file: "overview.webp",
        sha256: "a".repeat(64),
        width: 2048,
        height: 2048,
      },
      points: [p],
      provenance: {
        source_repository: "fixture",
        source_commit: "b".repeat(40),
        source_path: ["fixture"],
        client_version: "test",
        imported_at: new Date().toISOString(),
        importer_version: "test",
        schema_version: "map-v1",
        files: [{ path: "fixture", sha256: "c".repeat(64) }],
      },
      coverage: {
        terrain: "native-overview",
        entities: "static-point-entities",
        navigation: false,
        elevation: false,
        vision: false,
        skippedEntities: 0,
        unknownClasses: [],
      },
    };
    expect(mapPackageSchema.safeParse(sample).success).toBe(true);
    expect(
      mapPackageSchema.safeParse({ ...sample, points: [p, p] }).success,
    ).toBe(false);
    expect(
      mapPackageSchema.safeParse({ ...sample, points: [{ ...p, x: 1e9 }] })
        .success,
    ).toBe(false);
  });
});
