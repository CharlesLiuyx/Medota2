import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sha256 } from "@/importers/dota-map/files";
import { visionGroundZ } from "@/domain/map/vision";
import { readVisionScene } from "@/server/map/vision";

it("prepares only the selected package height, preserves unknown data and rejects changed source bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "medota-vision-source-"));
  try {
    const raw = Buffer.alloc(137);
    raw.write("vhcg");
    raw.writeUInt32LE(1, 4);
    raw.writeUInt32LE(128, 8);
    raw.writeUInt32LE(1, 12);
    raw.writeUInt32LE(1, 16);
    raw.writeUInt32LE(5, 20);
    raw.writeFloatLE(128, 24);
    raw.writeFloatLE(128, 128);
    const path = "raw/maps/dota.vhcg";
    const map = {
      schemaVersion: 1,
      mapName: "dota",
      bounds: { minX: 0, maxX: 128, minY: 0, maxY: 128 },
      image: {
        file: "overview.webp",
        sha256: "a".repeat(64),
        width: 512,
        height: 512,
      },
      points: [
        {
          id: "tree",
          kind: "tree",
          x: 40,
          y: 40,
          z: 128,
          team: "neutral",
          label: "tree",
          sourceClass: "tree",
          sourcePath: "fixture",
          properties: {},
        },
      ],
      provenance: {
        source_repository: "fixture",
        source_commit: null,
        source_path: [path],
        client_version: "fixture",
        imported_at: "2026-10-08T00:00:00.000Z",
        importer_version: "fixture",
        schema_version: "map-v1",
        files: [{ path, sha256: sha256(raw) }],
      },
      coverage: {
        terrain: "native-overview",
        entities: "static-point-entities",
        navigation: false,
        elevation: true,
        vision: false,
        skippedEntities: 0,
        unknownClasses: [],
      },
    };
    await mkdir(join(root, "source/raw/maps"), { recursive: true });
    await writeFile(join(root, "source", path), raw);
    const bytes = JSON.stringify(map);
    await writeFile(join(root, "map.json"), bytes);
    const data = await readVisionScene(root);
    expect(data.identity.datasetRevision).toBe(sha256(bytes));
    expect(data.identity.schema_version).toBe("vision-scene/3");
    expect(data.scene.terrain).toMatchObject({
      cell: 32,
      origin: { x: -16, y: -16 },
    });
    expect(data.scene.trees[0]).toEqual({ id: "tree", x: 40, y: 40, z: 128 });
    for (const x of [0, 15, 16, 63, 112, 120, 127])
      expect(visionGroundZ(data.scene, { x, y: 40 })).toBe(128);
    // A detailed native cell with a one-sample high ledge retains its exact
    // nearest-sample boundary even when the map image origin is not aligned.
    const detailed = Buffer.alloc(237);
    raw.copy(detailed);
    detailed[136] = 1;
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++)
        detailed.writeFloatLE(x >= 3 ? 256 : 128, 137 + (y * 5 + x) * 4);
    map.bounds.minX = 7;
    map.bounds.minY = 11;
    map.provenance.files = [{ path, sha256: sha256(detailed) }];
    await writeFile(join(root, "source", path), detailed);
    await writeFile(join(root, "map.json"), JSON.stringify(map));
    const nav = Buffer.alloc(36);
    nav.writeUInt32LE(0xfadebead, 0);
    nav.writeFloatLE(64, 4);
    nav.writeUInt32LE(2, 16);
    nav.writeUInt32LE(2, 20);
    const navPath = "raw/maps/dota.gnv";
    map.provenance.files.push({ path: navPath, sha256: sha256(nav) });
    await writeFile(join(root, "source", navPath), nav);
    await writeFile(join(root, "map.json"), JSON.stringify(map));
    const ledge = await readVisionScene(root);
    expect(ledge.scene.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 128,
      maxY: 128,
    });
    expect(ledge.identity.files).toContainEqual({
      path: navPath,
      sha256: sha256(nav),
    });
    expect(visionGroundZ(ledge.scene, { x: 79, y: 40 })).toBe(128);
    expect(visionGroundZ(ledge.scene, { x: 80, y: 40 })).toBe(256);
    raw.writeFloatLE(256, 128);
    await writeFile(join(root, "source", path), raw);
    await expect(readVisionScene(root)).rejects.toThrow("checksum mismatch");
    map.provenance.files = [{ path: "unrelated", sha256: "a".repeat(64) }];
    await writeFile(join(root, "map.json"), JSON.stringify(map));
    expect((await readVisionScene(root)).scene.terrain).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
