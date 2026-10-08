import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { sha256 } from "@/importers/dota-map/files";
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
      points: [],
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
    expect(data.scene.terrain?.values).toEqual([128, 128, 128, 128]);
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
