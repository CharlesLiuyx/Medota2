import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  collectMaps,
  inspectMaps,
  mapDigest,
  restoreMaps,
  verifyMapManifest,
} from "@/development/data-sync/maps";
import {
  sha256,
  type FileIdentity,
  type SnapshotManifest,
} from "@/development/data-sync/protocol";
import { blobPath, verifiedFile } from "@/development/data-sync/files";
import { loadMapAsset, loadMapPackage } from "@/server/map/packages";
import { verifyLiveDependencies } from "@/development/data-sync/dependencies";

vi.mock("@/config/env", () => ({ loadLocalEnv: () => {} }));
let root: string;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  root = await mkdtemp(resolve(tmpdir(), "map-sync-"));
  const versions = [];
  for (const [i, patch] of ["7.41e", "7.41f"].entries()) {
    const path = resolve(root, patch);
    await mkdir(resolve(path, "source"), { recursive: true });
    const bytes = Buffer.from(`native-${patch}`);
    const bounds = { minX: -100, maxX: 100, minY: -100, maxY: 100 };
    const map = {
      schemaVersion: 1,
      mapName: "dota",
      bounds,
      points: [],
      image: {
        file: "overview.webp",
        sha256: sha256(bytes),
        width: 2048,
        height: 2048,
      },
      rasterLayers: i
        ? ["navigation", "height"].map((id) => ({
            id,
            label: id,
            file: `${id}.webp`,
            sha256: sha256(bytes),
            bounds,
            width: 2,
            height: 2,
            note: "fixture",
          }))
        : [],
      provenance: {
        source_repository: "fixture",
        source_commit: "a".repeat(40),
        source_path: ["fixture"],
        client_version: i ? "6944" : null,
        public_source: {
          patch,
          verification: "source-declared",
          map_sha1: "a".repeat(40),
          steam_depot: "373301",
          steam_manifest: "123",
          attribution: "fixture",
        },
        imported_at: "2026-10-06T00:00:00.000Z",
        importer_version: "fixture",
        schema_version: "map-v1",
        files: [{ path: "fixture", sha256: sha256(bytes) }],
      },
      coverage: {
        terrain: "source-filmmaker",
        entities: "static-point-entities",
        navigation: false,
        elevation: Boolean(i),
        vision: false,
        skippedEntities: 0,
        unknownClasses: [],
      },
    };
    for (const name of [
      "overview.webp",
      "source/fixture",
      ...map.rasterLayers.map((l) => l.file),
    ])
      await writeFile(resolve(path, name), bytes);
    const metadata = JSON.stringify(map);
    await writeFile(resolve(path, "map.json"), metadata);
    versions.push({
      id: patch,
      patch,
      path: patch,
      clientVersion: map.provenance.client_version,
      revision: sha256(metadata),
    });
  }
  const collection = { schemaVersion: 1, defaultVersion: "7.41f", versions };
  const index = resolve(root, "local-collection.json");
  await writeFile(index, JSON.stringify(collection));
  vi.stubEnv("DOTA_MAP_COLLECTION_PATH", index);
  vi.stubEnv("DOTA_MAP_DATA_PATH", resolve(root, "7.41e"));
  return { collection, index, repository: resolve(root, "objects-repo") };
}

it("round-trips both map versions, every layer/source and default selection without local paths; detects changes hidden by a legacy input", async () => {
  const { collection, index, repository } = await fixture();
  const objects = new Map<string, FileIdentity>();
  const map = (await collectMaps(repository, objects))!;
  expect(map.files.map((f) => f.path)).toContain(
    "versions/7.41f/navigation.webp",
  );
  expect(map.files.map((f) => f.path)).toContain("versions/7.41f/height.webp");
  const restored = await restoreMaps(
    map,
    repository,
    resolve(root, "restored"),
  );
  vi.stubEnv("DOTA_MAP_COLLECTION_PATH", restored.mapCollectionPath!);
  expect(mapDigest(await inspectMaps())).toBe(mapDigest(map));
  const pkg = (await loadMapPackage(restored.mapCollectionPath!, undefined))!;
  expect(pkg.id).toBe("7.41f");
  expect(
    (await loadMapAsset(
      restored.mapCollectionPath!,
      undefined,
      pkg.id,
      "height.webp",
      pkg.revision,
    ))!.bytes.toString(),
  ).toBe("native-7.41f");
  expect(
    (await loadMapPackage(restored.mapCollectionPath!, undefined, "7.41e"))!.map
      .provenance.client_version,
  ).toBeNull();
  expect(
    await loadMapPackage(restored.mapCollectionPath!, undefined, "7.40"),
  ).toBeNull();
  vi.stubEnv("DOTA_MAP_COLLECTION_PATH", index);
  await writeFile(
    index,
    JSON.stringify({ ...collection, defaultVersion: "7.41e" }),
  );
  expect(
    await verifyLiveDependencies({
      map,
      sources: [],
    } as unknown as SnapshotManifest),
  ).toEqual([expect.stringContaining("differs")]);
  await writeFile(
    index,
    JSON.stringify({ ...collection, versions: collection.versions.slice(1) }),
  );
  expect(mapDigest(await inspectMaps())).not.toBe(mapDigest(map));
});

it("rejects missing declared layers/sources and incomplete manifests before restore, even with valid content hashes", async () => {
  const { repository } = await fixture();
  const map = (await collectMaps(repository, new Map()))!;
  const missing = {
    ...map,
    files: map.files.filter((f) => f.path !== "versions/7.41f/navigation.webp"),
  };
  await expect(
    verifyMapManifest(missing, (f) =>
      verifiedFile(blobPath(repository, f.sha256), f),
    ),
  ).rejects.toThrow("Incomplete");
  await unlink(resolve(root, "7.41f/height.webp"));
  await expect(inspectMaps()).rejects.toThrow();
  await writeFile(resolve(root, "7.41f/height.webp"), "native-7.41f");
  await writeFile(resolve(root, "7.41f/source/fixture"), "changed");
  await expect(inspectMaps()).rejects.toThrow("checksum");
});

it("restores legacy single-map snapshots and refuses a local extra collection when the target has only one version", async () => {
  const { index, repository } = await fixture();
  vi.stubEnv("DOTA_MAP_COLLECTION_PATH", "");
  const legacy = (await collectMaps(repository, new Map()))!;
  expect(legacy.collection).toBeUndefined();
  const restored = await restoreMaps(
    legacy,
    repository,
    resolve(root, "legacy"),
  );
  expect(restored.mapCollectionPath).toBeNull();
  expect(
    await readFile(resolve(restored.mapRoot!, "source/fixture"), "utf8"),
  ).toBe("native-7.41e");
  vi.stubEnv("DOTA_MAP_COLLECTION_PATH", index);
  expect(
    await verifyLiveDependencies({
      map: legacy,
      sources: [],
    } as unknown as SnapshotManifest),
  ).toEqual([expect.stringContaining("differs")]);
});
