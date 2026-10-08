import { readFile } from "node:fs/promises";
import { mapPackageSchema } from "@/domain/map/schema";
import type { VisionScene } from "@/domain/map/vision";
import { checkedFile, insideFile, sha256 } from "@/importers/dota-map/files";
import { parseHeightGrid } from "@/importers/dota-map/terrain";

/** Offline preparation only: no route, database, active collection or package write. */
export async function readVisionScene(root: string) {
  const bytes = await readFile(await insideFile(root, "map.json"));
  const map = mapPackageSchema.parse(JSON.parse(bytes.toString("utf8")));
  const cell = 64;
  const width = Math.ceil((map.bounds.maxX - map.bounds.minX) / cell);
  const height = Math.ceil((map.bounds.maxY - map.bounds.minY) / cell);
  if (width * height > 1_000_000) throw new Error("Vision terrain too large");
  const path = "raw/maps/dota.vhcg";
  const entry = map.provenance.files.find((f) => f.path === path);
  const terrain = entry
    ? parseHeightGrid(
        await checkedFile(root, `source/${path}`, [
          { path: `source/${path}`, sha256: entry.sha256 },
        ]),
      )
    : null;
  const values = terrain
    ? Array.from({ length: width * height }, (_, i) =>
        terrain.heightAt(
          map.bounds.minX + ((i % width) + 0.5) * cell,
          map.bounds.minY + (Math.floor(i / width) + 0.5) * cell,
        ),
      )
    : null;
  const scene: VisionScene = {
    bounds: map.bounds,
    trees: map.points
      .filter((p) => p.kind === "tree")
      .map(({ id, x, y }) => ({ id, x, y })),
    terrain: values
      ? {
          cell,
          width,
          height,
          origin: { x: map.bounds.minX, y: map.bounds.minY },
          values,
        }
      : null,
  };
  return {
    scene,
    identity: {
      datasetRevision: sha256(bytes),
      source_repository: map.provenance.source_repository,
      source_commit: map.provenance.source_commit,
      source_path: ["map.json", ...(entry ? [path] : [])],
      client_version: map.provenance.client_version,
      mapSha1:
        map.provenance.native_source?.map_sha1 ??
        map.provenance.public_source?.map_sha1 ??
        null,
      imported_at: map.provenance.imported_at,
      prepared_at: new Date().toISOString(),
      importer_version: "vision-scene/1",
      schema_version: "vision-scene/1",
      files: [
        { path: "map.json", sha256: sha256(bytes) },
        ...(entry ? [entry] : []),
      ],
    },
    limitations: [
      "Approximation; not compared with the game engine.",
      "Tree radius 64 and height bands 128 are adjustable model choices.",
      "VHCG ground samples are not engine FoW heights; missing heights remain unknown.",
      "No dedicated FoW lines, Roshan rules, flying vision, entity invisibility or time delay.",
    ],
  };
}
