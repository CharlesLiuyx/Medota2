import { readFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadLocalEnv } from "@/config/env";
import { assertOwnedPath, syncRoot } from "@/config/data-sync-state";
import { mapPackageSchema } from "@/domain/map/schema";
import {
  loadMapPackage,
  mapCollectionSchema,
  readCollection,
} from "@/server/map/packages";
import {
  assertPublishableText,
  assertRelativeFile,
  canonical,
  digest,
  sha256,
  type FileIdentity,
  type SnapshotManifest,
} from "./protocol";
import { blobPath, putBlob, putFile, verifiedFile } from "./files";

type MapManifest = NonNullable<SnapshotManifest["map"]>;
type Save = (bytes: Buffer) => Promise<FileIdentity>;
const identity = async (bytes: Buffer) => ({
  sha256: sha256(bytes),
  bytes: bytes.length,
});
const order = (map: MapManifest) => ({
  ...map,
  files: [...map.files].sort((a, b) => a.path.localeCompare(b.path, "en")),
});
export const mapDigest = (map: SnapshotManifest["map"]) =>
  digest(map ? order(map) : null);

async function packageFiles(
  root: string,
  prefix: string,
  save: Save,
): Promise<MapManifest["files"]> {
  const bytes = await readFile(
    assertOwnedPath(resolve(root, "map.json"), root),
  );
  assertPublishableText(bytes.toString("utf8"), "map.json");
  const map = mapPackageSchema.parse(JSON.parse(bytes.toString("utf8")));
  const expected = new Map<string, string | null>([
    ["map.json", sha256(bytes)],
  ]);
  for (const file of [map.image, ...map.rasterLayers]) {
    assertRelativeFile(file.file);
    if (expected.has(file.file)) throw new Error("Duplicate map asset path.");
    expected.set(file.file, file.sha256);
  }
  for (const file of map.provenance.files) {
    assertRelativeFile(file.path);
    const name = `source/${file.path}`;
    if (expected.has(name)) throw new Error("Duplicate map source path.");
    expected.set(name, file.sha256);
  }
  for (const name of (await readdir(root)).sort())
    if (
      /^(?:LICENSE(?:\.[a-z]+)?|NOTICE(?:\.[a-z]+)?|attribution\.json)$/i.test(
        name,
      )
    )
      expected.set(name, null);
  const files: MapManifest["files"] = [];
  for (const [name, hash] of expected) {
    assertRelativeFile(name);
    const data = await readFile(assertOwnedPath(resolve(root, name), root));
    if (hash && sha256(data) !== hash)
      throw new Error(`Map checksum mismatch: ${prefix}${name}`);
    files.push({ path: `${prefix}${name}`, ...(await save(data)) });
  }
  return files;
}

/** The same collection-first selection as the Web. No local directory names enter a snapshot. */
export async function inspectMaps(
  save: Save = identity,
): Promise<SnapshotManifest["map"]> {
  loadLocalEnv();
  const collectionPath = process.env.DOTA_MAP_COLLECTION_PATH;
  const legacyPath = process.env.DOTA_MAP_DATA_PATH;
  if (!collectionPath) {
    if (!legacyPath) return null;
    return order({ files: await packageFiles(resolve(legacyPath), "", save) });
  }
  const collection = await readCollection(collectionPath);
  const versions = [...collection.versions].sort((a, b) =>
    a.id.localeCompare(b.id, "en"),
  );
  const files: MapManifest["files"] = [];
  for (const version of versions) {
    const pkg = await loadMapPackage(collectionPath, legacyPath, version.id);
    if (!pkg) throw new Error(`Missing map version: ${version.id}`);
    files.push(
      ...(await packageFiles(pkg.root, `versions/${version.id}/`, save)),
    );
    if (
      files.find((file) => file.path === `versions/${version.id}/map.json`)
        ?.sha256 !== version.revision
    )
      throw new Error("Map changed during export; retry with stable inputs.");
  }
  const normalized = {
    ...collection,
    versions: versions.map((v) => ({ ...v, path: `versions/${v.id}` })),
  };
  const bytes = Buffer.from(canonical(normalized) + "\n");
  files.push({ path: "versions.json", ...(await save(bytes)) });
  return order({ collection: "versions.json", files });
}

export async function collectMaps(
  root: string,
  objects: Map<string, FileIdentity>,
) {
  return inspectMaps(async (bytes) => {
    const file = await putBlob(root, bytes);
    objects.set(file.sha256, file);
    return file;
  });
}

/** Verify semantic closure as well as bytes: a missing declared layer/source must fail before restore. */
export async function verifyMapManifest(
  map: SnapshotManifest["map"],
  read: (file: MapManifest["files"][number]) => Promise<Buffer>,
) {
  if (!map) return;
  const entries = new Map(map.files.map((f) => [f.path, f]));
  if (entries.size !== map.files.length)
    throw new Error("Duplicate map files.");
  for (const file of map.files) assertRelativeFile(file.path);
  const used = new Set<string>();
  const get = async (path: string, hash?: string) => {
    const file = entries.get(path);
    if (!file || (hash && file.sha256 !== hash))
      throw new Error(`Incomplete map dependencies: ${path}`);
    used.add(path);
    return read(file);
  };
  let versions: {
    prefix: string;
    revision?: string;
    patch?: string;
    clientVersion?: string | null;
  }[] = [{ prefix: "" }];
  if (map.collection) {
    const collection = mapCollectionSchema.parse(
      JSON.parse((await get(map.collection)).toString("utf8")),
    );
    versions = collection.versions.map((v) => {
      if (v.path !== `versions/${v.id}`)
        throw new Error("Noncanonical map collection path.");
      return { prefix: `${v.path}/`, ...v };
    });
  }
  for (const version of versions) {
    const metadata = await get(`${version.prefix}map.json`, version.revision);
    const pkg = mapPackageSchema.parse(JSON.parse(metadata.toString("utf8")));
    if (
      version.patch &&
      (pkg.provenance.public_source?.patch !== version.patch ||
        pkg.provenance.client_version !== version.clientVersion)
    )
      throw new Error("Map collection identity mismatch.");
    for (const asset of [pkg.image, ...pkg.rasterLayers]) {
      assertRelativeFile(asset.file);
      await get(`${version.prefix}${asset.file}`, asset.sha256);
    }
    for (const source of pkg.provenance.files) {
      assertRelativeFile(source.path);
      await get(`${version.prefix}source/${source.path}`, source.sha256);
    }
    for (const path of entries.keys()) {
      const name = path.slice(version.prefix.length);
      if (
        path.startsWith(version.prefix) &&
        /^(?:LICENSE(?:\.[a-z]+)?|NOTICE(?:\.[a-z]+)?|attribution\.json)$/i.test(
          name,
        )
      )
        await get(path);
    }
  }
  if (used.size !== entries.size)
    throw new Error("Map manifest contains undeclared files.");
}

export async function restoreMaps(
  map: SnapshotManifest["map"],
  repository: string,
  destination = resolve(syncRoot(), "maps"),
) {
  if (!map) return { mapRoot: null, mapCollectionPath: null };
  await verifyMapManifest(map, (file) =>
    verifiedFile(blobPath(repository, file.sha256), file),
  );
  const root = assertOwnedPath(
    resolve(destination, mapDigest(map)),
    destination,
  );
  await mkdir(root, { recursive: true });
  for (const file of map.files) {
    const path = assertOwnedPath(resolve(root, file.path), root);
    await mkdir(dirname(path), { recursive: true });
    if (!existsSync(path))
      await putFile(
        path,
        await verifiedFile(blobPath(repository, file.sha256), file),
      );
    await verifiedFile(path, file);
  }
  return map.collection
    ? { mapRoot: null, mapCollectionPath: resolve(root, map.collection) }
    : { mapRoot: root, mapCollectionPath: null };
}
