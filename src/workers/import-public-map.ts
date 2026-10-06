import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { mapPackageSchema } from "@/domain/map/schema";
import { argument, sha256 } from "@/importers/dota-map/files";
import { parseSloppyBounds, parseSloppyMap } from "@/importers/dota-map/sloppy";

async function main() {
  const args = process.argv.slice(2),
    commit = argument(args, "commit"),
    patch = argument(args, "patch"),
    output = resolve(argument(args, "output"));
  if (!/^[a-f0-9]{40}$/.test(commit) || !/^\d+\.\d+[a-z]?$/.test(patch))
    throw new Error("Use a full Git commit and exact gameplay patch");
  try {
    await stat(output);
    throw new Error("Output directory already exists");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const paths = [
    "data/map/patch_maps.json",
    "data/map/renders.json",
    "data/terrain_map_meta.json",
    `data/map/mapdata_${patch.replace(".", "")}.json`,
    `icons/maps/map_${patch}.webp`,
    "LICENSE",
  ];
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(
    resolve(dirname(output), `.${basename(output)}-`),
  );
  try {
    const files = await Promise.all(
      paths.map(async (path) => {
        const response = await fetch(
          `https://raw.githubusercontent.com/sikleq/Sloppy/${commit}/${path}`,
          { signal: AbortSignal.timeout(60000) },
        );
        if (!response.ok)
          throw new Error(`Download ${path}: ${response.status}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length > 16 * 1024 * 1024)
          throw new Error("Unexpectedly large map asset");
        const destination = resolve(staging, "source", path);
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, bytes);
        return { path, sha256: sha256(bytes) };
      }),
    );
    const json = async (path: string) =>
      JSON.parse(await readFile(resolve(staging, "source", path), "utf8"));
    const identity = z
      .object({
        patches: z.record(
          z.string(),
          z.object({
            sha1: z.string().regex(/^[a-f0-9]{40}$/),
            manifest: z.string().regex(/^\d+$/),
          }),
        ),
      })
      .parse(await json(paths[0])).patches[patch];
    if (!identity) throw new Error("Patch has no VPK identity");
    const renders = z
      .object({ pictures: z.record(z.string(), z.string()) })
      .parse(await json(paths[1]));
    if (renders.pictures[patch] !== "sfm")
      throw new Error(
        "Expected this patch's own SFM render; alternate engine/borrowed render requires separate review",
      );
    const entities = parseSloppyMap(
      await json(paths[3]),
      patch,
      identity.sha1,
      identity.manifest,
      paths[3],
    );
    const bytes = await readFile(resolve(staging, "source", paths[4]));
    const image = await sharp(bytes).metadata();
    if (
      image.format !== "webp" ||
      image.width !== 4096 ||
      image.height !== 4096
    )
      throw new Error("Expected original 4096px WebP; never upscale a preview");
    const map = mapPackageSchema.parse({
      schemaVersion: 1,
      mapName: "dota",
      bounds: parseSloppyBounds(await json(paths[2])),
      image: {
        file: "overview.webp",
        width: image.width,
        height: image.height,
        sha256: sha256(bytes),
      },
      points: entities.points,
      zones: entities.zones,
      provenance: {
        source_repository: "https://github.com/sikleq/Sloppy",
        source_commit: commit,
        source_path: paths,
        client_version: null,
        imported_at: new Date().toISOString(),
        importer_version: "sloppy-map/1",
        schema_version: "map-v1",
        files,
        public_source: {
          patch,
          verification: "source-declared",
          map_sha1: identity.sha1,
          steam_depot: "373301",
          steam_manifest: identity.manifest,
          attribution:
            "Map render and VPK extraction: sikleq/Sloppy. Dota 2 assets: Valve.",
        },
      },
      coverage: {
        terrain: "source-filmmaker",
        entities: "static-point-entities",
        navigation: false,
        elevation: false,
        vision: false,
        skippedEntities: 0,
        unknownClasses: entities.unknownClasses,
      },
    });
    await writeFile(resolve(staging, "overview.webp"), bytes);
    await writeFile(resolve(staging, "map.json"), JSON.stringify(map));
    await rename(staging, output);
    console.log(
      JSON.stringify(
        {
          output,
          patch,
          clientVersion: null,
          points: map.points.length,
          zones: map.zones.length,
          image: map.image,
          sourceCommit: commit,
          mapSha1: identity.sha1,
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
