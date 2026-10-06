import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertOwnedPath } from "@/config/data-sync-state";
import type { VerifiedDatabase } from "@/server/environment/contract";
import { tables, schemaDigest, assertTextRow } from "./schema";
import { collectDatabase, migrationDigest } from "./database";
import { collectMap, collectSources } from "./dependencies";
import { blobPath, chunkPath, putFile, verifiedFile } from "./files";
import {
  canonical,
  digest,
  sha256,
  manifestSchema,
  snapshotId,
  hashSchema,
  assertRelativeFile,
  type SnapshotManifest,
  type FileIdentity,
} from "./protocol";
const exec = promisify(execFile);

export function manifestPath(root: string, id: string): string {
  hashSchema.parse(id);
  return assertOwnedPath(resolve(root, "snapshots", id, "manifest.json"), root);
}
export async function exportSnapshot(
  database: VerifiedDatabase<"read">,
  root: string,
  parents: string[] = [],
): Promise<{
  snapshotId: string;
  manifestSha256: string;
  manifest: SnapshotManifest;
  root: string;
}> {
  await mkdir(root, { recursive: true });
  const content = await database.readSnapshot((reader) =>
    collectDatabase(reader, root),
  );
  const sources = await collectSources(
    content.sourceRows,
    content.sourceFileRows,
  );
  const objects = new Map(content.objects.map((file) => [file.sha256, file]));
  const map = await collectMap(root, objects);
  const environment = database.identity.environment;
  if (environment !== "development" && environment !== "local-review")
    throw new Error("Only development/review snapshots may be exported.");
  const manifest: SnapshotManifest = {
    version: 1,
    exporter: "medota2-snapshot/1",
    codeCommit: (await exec("git", ["rev-parse", "HEAD"])).stdout.trim(),
    exportedAt: new Date().toISOString(),
    parents,
    schemaDigest,
    migrationsDigest: await migrationDigest(),
    environment,
    databaseDigest: digest(content.tables),
    tables: content.tables,
    objects: [...objects.values()].sort((a, b) =>
      a.sha256.localeCompare(b.sha256),
    ),
    sources,
    map,
    heads: content.heads,
  };
  manifestSchema.parse(manifest);
  const id = snapshotId(manifest);
  const path = manifestPath(root, id);
  if (!existsSync(path)) await putFile(path, canonical(manifest) + "\n");
  const saved = await readSnapshot(root, id);
  return {
    snapshotId: id,
    manifestSha256: saved.manifestSha256,
    manifest: saved.manifest,
    root,
  };
}

export async function readSnapshot(
  root: string,
  id: string,
  expectedHash?: string,
): Promise<{ manifest: SnapshotManifest; manifestSha256: string }> {
  const bytes = await readFile(manifestPath(root, id));
  const hash = sha256(bytes);
  if (expectedHash && expectedHash !== hash)
    throw new Error("Snapshot manifest checksum mismatch.");
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (snapshotId(manifest) !== id)
    throw new Error("Snapshot identity mismatch.");
  if (
    manifest.schemaDigest !== schemaDigest ||
    manifest.migrationsDigest !== (await migrationDigest())
  )
    throw new Error(
      "Snapshot schema/migrations do not match this code. Check out the matching code version first.",
    );
  const names = manifest.tables.map((table) => table.name);
  if (
    new Set(names).size !== names.length ||
    names.join() !== tables.map((table) => table.name).join()
  )
    throw new Error(
      "Snapshot table inventory differs from the reviewed schema.",
    );
  if (digest(manifest.tables) !== manifest.databaseDigest)
    throw new Error("Snapshot database digest mismatch.");
  if (
    new Set(manifest.objects.map((file) => file.sha256)).size !==
    manifest.objects.length
  )
    throw new Error("Duplicate snapshot objects.");
  if (
    new Set(manifest.sources.map((source) => source.commit)).size !==
    manifest.sources.length
  )
    throw new Error("Duplicate source commits.");
  for (const source of manifest.sources)
    for (const file of source.files) assertRelativeFile(file.path);
  if (manifest.map) {
    const files = manifest.map.files.map((file) => file.path);
    files.forEach(assertRelativeFile);
    if (
      new Set(files).size !== files.length ||
      !files.includes("map.json") ||
      !files.includes("overview.webp")
    )
      throw new Error("Incomplete map dependencies.");
  }
  return { manifest, manifestSha256: hash };
}

export async function verifySnapshotFiles(
  root: string,
  manifest: SnapshotManifest,
): Promise<{ bytes: number; rows: number }> {
  let bytes = 0,
    total = 0;
  const required = new Map<string, FileIdentity>();
  const heads: SnapshotManifest["heads"] = {};
  for (const table of tables) {
    const saved = manifest.tables.find((entry) => entry.name === table.name)!;
    let rows = 0;
    for (const chunk of saved.chunks) {
      const data = await verifiedFile(chunkPath(root, chunk.sha256), chunk);
      if (!data.length || data.at(-1) !== 10)
        throw new Error("Invalid NDJSON chunk terminator.");
      for (const line of data.toString("utf8").trimEnd().split("\n")) {
        const row: unknown = JSON.parse(line);
        assertTextRow(table, row);
        rows++;
        if (table.name === "asset_blobs") {
          const hash = row.content_sha256!;
          if (row.content !== `sha256:${hash}`)
            throw new Error("Invalid asset content reference.");
          required.set(hash, { sha256: hash, bytes: Number(row.byte_size) });
        }
        if (
          ["dataset_heads", "asset_dataset_heads", "unit_asset_heads"].includes(
            table.name,
          )
        )
          (heads[table.name] ??= []).push(row);
      }
      bytes += data.length;
    }
    if (rows !== saved.rows)
      throw new Error(`Snapshot row count mismatch: ${table.name}`);
    total += rows;
  }
  if (digest(heads) !== digest(manifest.heads))
    throw new Error("Snapshot heads do not match its tables.");
  for (const file of manifest.map?.files ?? [])
    required.set(file.sha256, { sha256: file.sha256, bytes: file.bytes });
  if (
    digest(
      [...required.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)),
    ) !== digest(manifest.objects)
  )
    throw new Error("Snapshot objects differ from referenced content.");
  for (const file of manifest.objects) {
    await verifiedFile(blobPath(root, file.sha256), file);
    bytes += file.bytes;
  }
  return { bytes, rows: total };
}
