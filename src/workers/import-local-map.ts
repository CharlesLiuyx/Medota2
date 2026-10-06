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
import { mapPackageSchema, type MapPackage } from "@/domain/map/schema";
import { argument, checkedFile, sha256 } from "@/importers/dota-map/files";
import { campHulls, nativeMapEntities } from "@/importers/dota-map/native";
import {
  parseGridNav,
  parseHeightGrid,
  terrainPixels,
} from "@/importers/dota-map/terrain";
import { parseSteamInf } from "@/importers/dota-vpk/steam";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z.object({
  schemaVersion: z.literal(2),
  source_repository: z.literal("steam:570"),
  source_commit: z.null(),
  client_version: z.string(),
  source_revision: z.string(),
  source2viewer: z.string(),
  map_sha1: z.string().regex(/^[a-f0-9]{40}$/),
  map_vpk_verified: z.literal(true),
  files: z.array(z.object({ path: z.string(), sha256: hash })),
  archives: z.array(z.object({ path: z.string(), sha256: hash })),
});
async function main() {
  const args = process.argv.slice(2),
    input = resolve(argument(args, "input")),
    render = resolve(argument(args, "render")),
    output = resolve(argument(args, "output"));
  try {
    await stat(output);
    throw new Error("Output directory already exists");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const manifestBytes = await readFile(resolve(input, "extraction.json"));
  const manifest = manifestSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  if (new Set(manifest.files.map((f) => f.path)).size !== manifest.files.length)
    throw new Error("Duplicate manifest file");
  const bytes = new Map<string, Buffer>();
  for (const file of manifest.files)
    bytes.set(file.path, await checkedFile(input, file.path, manifest.files));
  const required = (p: string) => {
    const b = bytes.get(p);
    if (!b) throw new Error(`Missing source: ${p}`);
    return b;
  };
  const steam = parseSteamInf(required("steam.inf").toString("utf8"));
  if (
    steam.clientVersion !== manifest.client_version ||
    steam.sourceRevision !== manifest.source_revision
  )
    throw new Error("Client identity mismatch");
  const referenceBytes = await readFile(resolve(render, "map.json")),
    reference = mapPackageSchema.parse(
      JSON.parse(referenceBytes.toString("utf8")),
    );
  const pub = reference.provenance.public_source;
  if (
    !pub ||
    pub.map_sha1 !== manifest.map_sha1 ||
    reference.coverage.terrain !== "source-filmmaker" ||
    !reference.provenance.source_commit
  )
    throw new Error("Render and native map versions disagree");
  const image = await readFile(resolve(render, "overview.webp"));
  if (sha256(image) !== reference.image.sha256)
    throw new Error("Render checksum mismatch");
  const renderEvidence = new Map<string, Buffer>();
  for (const file of reference.provenance.files)
    renderEvidence.set(
      `render/${file.path}`,
      await checkedFile(
        resolve(render, "source"),
        file.path,
        reference.provenance.files,
      ),
    );
  const info = await sharp(image).metadata();
  if (
    info.width !== reference.image.width ||
    info.height !== reference.image.height ||
    info.width! < 4096
  )
    throw new Error("Expected original high-resolution render");
  const dumps = new Map(
    [...bytes]
      .filter(([p]) => p.startsWith("entities/") && p.endsWith(".vents"))
      .map(([p, b]) => [p, b.toString("utf8")]),
  );
  const native = nativeMapEntities(dumps);
  // Independent reference checks catch double-transformed world layers, missing trees and camps.
  for (const kind of ["tree", "tower", "camp"]) {
    const local = native.points.filter((p) => p.kind === kind),
      expected = reference.points.filter((p) => p.kind === kind);
    const remaining = [...expected];
    if (local.length !== expected.length)
      throw new Error(`Reference count mismatch: ${kind}`);
    for (const point of local) {
      const i = remaining.findIndex(
        (p) => Math.abs(p.x - point.x) <= 1 && Math.abs(p.y - point.y) <= 1,
      );
      if (i < 0) throw new Error(`Reference coordinate mismatch: ${point.id}`);
      remaining.splice(i, 1);
    }
  }
  const zones: MapPackage["zones"] = [];
  for (const r of native.records) {
    const p = r.properties;
    if (
      p.classname !== "trigger_multiple" ||
      !/^\[PR#\]neutralcamp|^neutralcamp/.test(
        p.targetname ?? p.volumename ?? "",
      )
    )
      continue;
    const model = (p.model ?? "")
      .replace(/^resource_name:/, "")
      .replaceAll('"', "")
      .replaceAll("\\", "/");
    const name = basename(model).replace(/\.vmdl(?:_c)?$/, ".vmdl_c.txt");
    zones.push(
      ...campHulls(required(`hull-dumps/${name}`).toString("utf8"), p, r.id),
    );
  }
  if (zones.length !== reference.zones.length)
    throw new Error(
      "Camp hull count differs from reference; review before import",
    );
  const nav = parseGridNav(required("raw/maps/dota.gnv")),
    height = parseHeightGrid(required("raw/maps/dota.vhcg")),
    pixels = terrainPixels(nav, height);
  const navImage = await sharp(pixels.navigation, {
    raw: { width: nav.width, height: nav.height, channels: 4 },
  })
    .webp({ lossless: true })
    .toBuffer();
  const heightImage = await sharp(pixels.elevation, {
    raw: { width: pixels.width, height: pixels.rows, channels: 4 },
  })
    .webp({ lossless: true })
    .toBuffer();
  const archive = manifest.archives.find((a) => a.path === "maps/dota.vpk");
  if (!archive) throw new Error("Missing map archive fingerprint");
  const map = mapPackageSchema.parse({
    schemaVersion: 1,
    mapName: "dota",
    bounds: reference.bounds,
    image: reference.image,
    points: native.points,
    zones,
    rasterLayers: [
      {
        id: "navigation",
        label: "导航栅格",
        file: "navigation.webp",
        sha256: sha256(navImage),
        bounds: nav.bounds,
        width: nav.width,
        height: nav.height,
        note: "64单位/格；绿：可通行标记，紫：禁插眼标记，灰：阻挡，黄：含未知位。社区解码，未计入树木等动态阻挡。",
      },
      {
        id: "height",
        label: "地面高度",
        file: "height.webp",
        sha256: sha256(heightImage),
        bounds: pixels.bounds,
        width: pixels.width,
        height: pixels.rows,
        note: "蓝0、绿128、黄256、橙384、红512、紫640、灰768+。原生128单位主格/32单位细分样本；社区解码，未在引擎验证。",
      },
    ],
    provenance: {
      source_repository: manifest.source_repository,
      source_commit: null,
      source_path: manifest.files.map((f) => f.path),
      client_version: manifest.client_version,
      imported_at: new Date().toISOString(),
      importer_version: "local-map/1",
      schema_version: "map-v1",
      files: [
        ...manifest.files,
        { path: "extraction.json", sha256: sha256(manifestBytes) },
        { path: "render/map.json", sha256: sha256(referenceBytes) },
        ...[...renderEvidence].map(([path, b]) => ({
          path,
          sha256: sha256(b),
        })),
      ],
      public_source: pub,
      render_source: {
        repository: reference.provenance.source_repository,
        commit: reference.provenance.source_commit,
        package_sha256: sha256(referenceBytes),
      },
      native_source: {
        map_sha1: manifest.map_sha1,
        map_sha256: archive.sha256,
        source_revision: manifest.source_revision,
        source2viewer: manifest.source2viewer,
        verification: "local-map-hash-matched",
        active_layers: native.active,
        inactive_layers: native.inactive,
      },
    },
    coverage: {
      terrain: "source-filmmaker",
      entities: "static-point-entities",
      navigation: false,
      elevation: true,
      vision: false,
      skippedEntities: native.skipped,
      unknownClasses: native.unknownClasses,
      omittedNonGameplayEntities: native.omitted,
    },
  });
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(
    resolve(dirname(output), `.${basename(output)}-`),
  );
  try {
    await writeFile(resolve(staging, "overview.webp"), image);
    await writeFile(resolve(staging, "navigation.webp"), navImage);
    await writeFile(resolve(staging, "height.webp"), heightImage);
    // A portable dataset owns its evidence; it does not depend on the extraction cache staying in place.
    for (const [path, b] of [...bytes, ...renderEvidence]) {
      await mkdir(dirname(resolve(staging, "source", path)), {
        recursive: true,
      });
      await writeFile(resolve(staging, "source", path), b);
    }
    await mkdir(resolve(staging, "source/render"), { recursive: true });
    await writeFile(resolve(staging, "source/render/map.json"), referenceBytes);
    await writeFile(resolve(staging, "source/extraction.json"), manifestBytes);
    await writeFile(resolve(staging, "map.json"), JSON.stringify(map));
    await rename(staging, output);
    console.log(
      JSON.stringify(
        {
          output,
          patch: pub.patch,
          client: steam.clientVersion,
          points: map.points.length,
          camps: zones.length,
          active: native.active,
          inactive: native.inactive,
          grid: [nav.width, nav.height],
          referenceCoordinatesVerified: ["tree", "tower", "camp"],
        },
        null,
        2,
      ),
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
