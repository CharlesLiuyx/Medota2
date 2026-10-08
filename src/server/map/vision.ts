import { readFile } from "node:fs/promises";
import { mapPackageSchema } from "@/domain/map/schema";
import { VISION_SCENE_FORMAT, type VisionScene } from "@/domain/map/vision";
import { checkedFile, insideFile, sha256 } from "@/importers/dota-map/files";
import { parseHeightGrid, parseGridNav } from "@/importers/dota-map/terrain";

/** Prepare an explicitly selected package for offline or Web use; no database or package write. */
export async function readVisionScene(root: string) {
  const bytes = await readFile(await insideFile(root, "map.json"));
  const map = mapPackageSchema.parse(JSON.parse(bytes.toString("utf8")));
  const navigationPath = "raw/maps/dota.gnv";
  const navigationEntry = map.provenance.files.find(
    (f) => f.path === navigationPath,
  );
  const navigation = navigationEntry
    ? parseGridNav(
        await checkedFile(root, `source/${navigationPath}`, [
          { path: `source/${navigationPath}`, sha256: navigationEntry.sha256 },
        ]),
      )
    : null;
  // Coverage, placement and collision cells use the native navigation lattice.
  const bounds = navigation
    ? {
        minX:
          navigation.bounds.minX +
          Math.floor((map.bounds.minX - navigation.bounds.minX) / 64) * 64,
        minY:
          navigation.bounds.minY +
          Math.floor((map.bounds.minY - navigation.bounds.minY) / 64) * 64,
        maxX:
          navigation.bounds.minX +
          Math.ceil((map.bounds.maxX - navigation.bounds.minX) / 64) * 64,
        maxY:
          navigation.bounds.minY +
          Math.ceil((map.bounds.maxY - navigation.bounds.minY) / 64) * 64,
      }
    : map.bounds;
  const path = "raw/maps/dota.vhcg";
  const entry = map.provenance.files.find((f) => f.path === path);
  const terrain = entry
    ? parseHeightGrid(
        await checkedFile(root, `source/${path}`, [
          { path: `source/${path}`, sha256: entry.sha256 },
        ]),
      )
    : null;
  // Native detail samples define nearest-neighbour Voronoi cells. Preserve that
  // lattice, including its half-step boundary, instead of shifting it to image bounds.
  const cell = terrain ? terrain.cell / (terrain.samples - 1) : 64;
  const origin = terrain
    ? {
        x:
          terrain.origin.x -
          cell / 2 +
          Math.floor((map.bounds.minX - terrain.origin.x + cell / 2) / cell) *
            cell,
        y:
          terrain.origin.y -
          cell / 2 +
          Math.floor((map.bounds.minY - terrain.origin.y + cell / 2) / cell) *
            cell,
      }
    : { x: map.bounds.minX, y: map.bounds.minY };
  const width = Math.ceil((map.bounds.maxX - origin.x) / cell);
  const height = Math.ceil((map.bounds.maxY - origin.y) / cell);
  if (width * height > 1_000_000) throw new Error("Vision terrain too large");
  const values = terrain
    ? Array.from({ length: width * height }, (_, i) =>
        terrain.heightAt(
          origin.x + ((i % width) + 0.5) * cell,
          origin.y + (Math.floor(i / width) + 0.5) * cell,
        ),
      )
    : null;
  const subcells: Record<number, (number | null)[]> = {};
  if (terrain && values)
    for (let i = 0; i < values.length; i++) {
      const x = origin.x + (i % width) * cell,
        y = origin.y + Math.floor(i / width) * cell;
      const quarters = Array.from({ length: 4 }, (_, q) =>
        terrain.heightAt(
          x + (((q % 2) + 0.5) * cell) / 2,
          y + ((Math.floor(q / 2) + 0.5) * cell) / 2,
        ),
      );
      if (quarters.some((z) => z !== values[i])) subcells[i] = quarters;
    }
  const scene: VisionScene = {
    bounds,
    trees: map.points
      .filter((p) => p.kind === "tree")
      .map(({ id, x, y, z }) => ({ id, x, y, z })),
    terrain: values
      ? {
          cell,
          width,
          height,
          origin,
          values,
          subcells,
        }
      : null,
  };
  return {
    scene,
    identity: {
      datasetRevision: sha256(bytes),
      source_repository: map.provenance.source_repository,
      source_commit: map.provenance.source_commit,
      source_path: [
        "map.json",
        ...(entry ? [path] : []),
        ...(navigationEntry ? [navigationPath] : []),
      ],
      client_version: map.provenance.client_version,
      mapSha1:
        map.provenance.native_source?.map_sha1 ??
        map.provenance.public_source?.map_sha1 ??
        null,
      imported_at: map.provenance.imported_at,
      prepared_at: new Date().toISOString(),
      importer_version: VISION_SCENE_FORMAT,
      schema_version: VISION_SCENE_FORMAT,
      files: [
        { path: "map.json", sha256: sha256(bytes) },
        ...(entry ? [entry] : []),
        ...(navigationEntry ? [navigationEntry] : []),
      ],
    },
    limitations: [
      "Approximation; not compared with the game engine.",
      "Tree radius 64, effective tree height 128 and height bands 128 are adjustable model choices.",
      "VHCG ground samples are not engine FoW heights; missing heights remain unknown.",
      "No dedicated FoW lines, Roshan rules, flying vision, entity invisibility or time delay.",
    ],
  };
}
