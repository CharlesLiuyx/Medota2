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
import { parseSteamInf } from "@/importers/dota-vpk/steam";
import { mapPackageSchema } from "@/domain/map/schema";
import {
  MAP_IMPORTER_VERSION,
  parseEntityDump,
  parseOverview,
} from "@/importers/dota-map/adapter";
import { argument, checkedFile, sha256 } from "@/importers/dota-map/files";
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  source_repository: z.string(),
  source_commit: z.string().regex(/^[a-f0-9]{40}$/),
  client_version: z.string(),
  files: z.array(
    z.object({ path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }),
  ),
});
async function main() {
  const args = process.argv.slice(2),
    root = resolve(argument(args, "input")),
    output = resolve(argument(args, "output"));
  const texturePath = argument(args, "texture"),
    entityPath = argument(args, "entities");
  try {
    await stat(output);
    throw new Error("Output directory already exists");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const manifestBytes = await readFile(resolve(root, "extraction.json"));
  const manifest = manifestSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  const [overviewBytes, texture, dump, steam] = await Promise.all([
    checkedFile(root, "overview.txt", manifest.files),
    checkedFile(root, texturePath, manifest.files),
    checkedFile(root, entityPath, manifest.files),
    checkedFile(root, "steam.inf", manifest.files),
  ]);
  if (
    parseSteamInf(steam.toString("utf8")).clientVersion !==
    manifest.client_version
  )
    throw new Error("Extraction client version disagrees with steam.inf");
  if (
    !texturePath.startsWith("textures/") ||
    !entityPath.startsWith("entities/")
  )
    throw new Error(
      "Select texture and root entity dump from their extraction directories",
    );
  const overview = parseOverview(overviewBytes.toString("utf8"));
  if (
    !overview.material ||
    !/^materials\/overviews\/[a-z0-9_]+\.vmat$/i.test(overview.material)
  )
    throw new Error("Unsupported overview material reference");
  const materialPath = `textures/${overview.material}`;
  const material = (
    await checkedFile(root, materialPath, manifest.files)
  ).toString("utf8");
  const binding =
    /(?:"?(?:TextureColor|g_tColor)"?)\s*(?:=\s*)?(?:resource:)?"([^"\r\n]+)"/.exec(
      material,
    )?.[1];
  if (!binding || !binding.endsWith(".vtex"))
    throw new Error(
      "Current dota material has no supported color-texture binding; inspect the extracted material",
    );
  const expectedStem = `textures/${binding.slice(0, -5)}`;
  if (
    parseSteamInf(steam.toString("utf8")).clientVersion !==
    manifest.client_version
  )
    throw new Error("Extraction client version disagrees with steam.inf");
  if (
    !texturePath.startsWith(expectedStem + ".") ||
    !/\.(png|tga|webp)$/i.test(texturePath)
  )
    throw new Error(
      "Selected texture does not match the current dota material; historical/alternate maps cannot be substituted",
    );
  const entities = parseEntityDump(dump.toString("utf8"), entityPath);
  if (!entities.points.length)
    throw new Error("Entity dump contains no positioned points");
  const image = await sharp(texture, { limitInputPixels: 64 * 1024 * 1024 })
    .webp({ lossless: true })
    .toBuffer({ resolveWithObject: true });
  if (image.info.width !== image.info.height || image.info.width < 1024)
    throw new Error(
      "Use the original square overview texture (at least 1024 pixels); never upscale a preview",
    );
  const map = mapPackageSchema.parse({
    schemaVersion: 1,
    mapName: "dota",
    bounds: overview.bounds,
    image: {
      file: "overview.webp",
      sha256: sha256(image.data),
      width: image.info.width,
      height: image.info.height,
    },
    points: entities.points,
    provenance: {
      source_repository: manifest.source_repository,
      source_commit: manifest.source_commit,
      source_path: [
        "resource/overviews/dota.txt",
        texturePath,
        materialPath,
        entityPath,
      ],
      client_version: manifest.client_version,
      imported_at: new Date().toISOString(),
      importer_version: MAP_IMPORTER_VERSION,
      schema_version: "map-v1",
      files: [
        ...manifest.files.filter((f) =>
          [
            "overview.txt",
            "steam.inf",
            texturePath,
            materialPath,
            entityPath,
          ].includes(f.path),
        ),
        { path: "extraction.json", sha256: sha256(manifestBytes) },
      ],
    },
    coverage: {
      terrain: "native-overview",
      entities: "static-point-entities",
      navigation: false,
      elevation: false,
      vision: false,
      skippedEntities: entities.skipped,
      unknownClasses: entities.unknownClasses,
    },
  });
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(
    resolve(dirname(output), `.${basename(output)}-`),
  );
  try {
    await writeFile(resolve(staging, "overview.webp"), image.data);
    await writeFile(resolve(staging, "map.json"), JSON.stringify(map));
    await writeFile(resolve(staging, "extraction.json"), manifestBytes);
    await rename(staging, output);
    console.log(
      JSON.stringify(
        {
          output,
          points: map.points.length,
          image: map.image,
          coverage: map.coverage,
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
