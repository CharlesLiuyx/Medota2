import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  loadMapAsset,
  loadMapPackage,
  mapCollectionSchema,
} from "@/server/map/packages";
import { sha256 } from "@/importers/dota-map/files";

it("serves two independently pinned versions concurrently, rejects mixed images and never substitutes missing versions", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "map-versions-"));
  try {
    const versions = [];
    for (const [i, patch] of ["7.41e", "7.41f"].entries()) {
      await mkdir(resolve(root, patch));
      const image = Buffer.from(`image-${patch}`);
      const map = {
        schemaVersion: 1,
        mapName: "dota",
        bounds: { minX: -100, maxX: 100, minY: -100, maxY: 100 },
        image: {
          file: "overview.webp",
          sha256: sha256(image),
          width: 4096,
          height: 4096,
        },
        points: [
          {
            id: "tower",
            label: "塔",
            kind: "tower",
            x: i * 10,
            y: 0,
            z: null,
            team: "unknown",
            sourceClass: "npc_dota_tower",
            sourcePath: "fixture",
            properties: {},
          },
        ],
        provenance: {
          source_repository: "fixture",
          source_commit: "a".repeat(40),
          source_path: ["fixture"],
          client_version: null,
          public_source: {
            patch,
            verification: "source-declared",
            map_sha1: String(i).repeat(40),
            steam_depot: "373301",
            steam_manifest: "123",
            attribution: "fixture",
          },
          imported_at: new Date().toISOString(),
          importer_version: "fixture",
          schema_version: "map-v1",
          files: [{ path: "fixture", sha256: "a".repeat(64) }],
        },
        coverage: {
          terrain: "source-filmmaker",
          entities: "static-point-entities",
          navigation: false,
          elevation: false,
          vision: false,
          skippedEntities: 0,
          unknownClasses: [],
        },
      };
      const bytes = JSON.stringify(map);
      await writeFile(resolve(root, patch, "map.json"), bytes);
      await writeFile(resolve(root, patch, "overview.webp"), image);
      versions.push({
        id: patch,
        patch,
        path: patch,
        clientVersion: null,
        revision: sha256(bytes),
      });
    }
    const index = resolve(root, "versions.json"),
      collection = { schemaVersion: 1, defaultVersion: "7.41f", versions };
    await writeFile(index, JSON.stringify(collection));
    const [a, b] = await Promise.all([
      loadMapPackage(index, undefined, "7.41e"),
      loadMapPackage(index, undefined, "7.41f"),
    ]);
    expect(a!.map.points[0].x).toBe(0);
    expect(b!.map.points[0].x).toBe(10);
    expect(
      (await loadMapAsset(
        index,
        undefined,
        "7.41e",
        "overview.webp",
        a!.revision,
      ))!.bytes.toString(),
    ).toBe("image-7.41e");
    expect(
      await loadMapAsset(
        index,
        undefined,
        "7.41e",
        "overview.webp",
        b!.revision,
      ),
    ).toBe(null);
    expect(
      await loadMapAsset(index, undefined, "7.41f", "height.webp", b!.revision),
    ).toBe(null);
    expect(await loadMapPackage(index, undefined, "7.41d")).toBe(null);
    expect(
      mapCollectionSchema.safeParse({
        ...collection,
        versions: [versions[0], versions[0]],
      }).success,
    ).toBe(false);
    await writeFile(resolve(root, "7.41e/overview.webp"), "tampered");
    await expect(
      loadMapAsset(index, undefined, "7.41e", "overview.webp", a!.revision),
    ).rejects.toThrow("checksum");
    await writeFile(
      index,
      JSON.stringify({
        ...collection,
        versions: [{ ...versions[0], patch: "7.41f" }, versions[1]],
      }),
    );
    await expect(loadMapPackage(index, undefined, "7.41e")).rejects.toThrow(
      "identity",
    );
    await writeFile(
      index,
      JSON.stringify({
        ...collection,
        versions: [{ ...versions[0], path: "../escape" }, versions[1]],
      }),
    );
    await expect(loadMapPackage(index, undefined, "7.41e")).rejects.toThrow(
      "relative path",
    );
    expect(
      (await readFile(resolve(root, "7.41f/overview.webp"))).toString(),
    ).toBe("image-7.41f");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
