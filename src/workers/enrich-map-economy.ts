import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { mapPackageSchema } from "@/domain/map/schema";
import {
  argument,
  checkedFile,
  fileSha256,
  listFiles,
  sha256,
} from "@/importers/dota-map/files";
import { adaptEconomy, lanePaths } from "@/importers/dota-map/economy";
import { campHulls } from "@/importers/dota-map/native";
import { readEntityRecords } from "@/importers/dota-map/adapter";
import { parseSteamInf } from "@/importers/dota-vpk/steam";
const exec = promisify(execFile);
async function main() {
  const args = process.argv.slice(2),
    input = resolve(argument(args, "input")),
    output = resolve(argument(args, "output")),
    vpk = resolve(argument(args, "vpk")),
    cli = resolve(argument(args, "cli"));
  try {
    await stat(output);
    throw new Error("Output directory already exists");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const mapBytes = await readFile(resolve(input, "map.json")),
    map = mapPackageSchema.parse(JSON.parse(mapBytes.toString()));
  if (!map.provenance.native_source)
    throw new Error("A verified native map dataset is required");
  const game = dirname(vpk),
    steamBytes = await readFile(resolve(game, "steam.inf")),
    steam = parseSteamInf(steamBytes.toString());
  const archive = resolve(game, "maps/dota.vpk");
  const mapHash = createHash("sha1")
    .update(await readFile(archive))
    .digest("hex");
  if (
    mapHash !== map.provenance.native_source.map_sha1 ||
    steam.clientVersion !== map.provenance.client_version ||
    steam.sourceRevision !== map.provenance.native_source.source_revision
  )
    throw new Error("Installed game and selected map dataset disagree");
  const before = await Promise.all([fileSha256(vpk), fileSha256(archive)]);
  for (const f of map.provenance.files)
    await checkedFile(resolve(input, "source"), f.path, map.provenance.files);
  for (const a of [map.image, ...map.rasterLayers])
    if ((await fileSha256(resolve(input, a.file))) !== a.sha256)
      throw new Error("Dataset image checksum mismatch");
  await mkdir(dirname(output), { recursive: true });
  const staging = await mkdtemp(
    resolve(dirname(output), `.${basename(output)}-`),
  );
  try {
    await cp(input, staging, { recursive: true, force: false });
    const evidence = resolve(staging, "source/economy");
    await mkdir(evidence, { recursive: true });
    const paths = [
      "scripts/npc/npc_units.txt",
      "scripts/npc/npc_abilities.txt",
      "scripts/creep_pull_timings.txt",
      "resource/localization/abilities_schinese.txt",
    ];
    await exec(cli, ["-i", vpk, "-o", evidence, "-f", paths.join(",")], {
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
    });
    await writeFile(resolve(evidence, "steam.inf"), steamBytes);
    await cp(resolve(game, "dota.fgd"), resolve(evidence, "dota.fgd"));
    const read = (p: string) => readFile(resolve(evidence, p), "utf8");
    map.economy = adaptEconomy(
      map,
      await read(paths[0]),
      await read(paths[1]),
      await read(paths[2]),
      await read(paths[3]),
    );
    const rootPath = "entities/maps/dota/entities/default_ents.vents";
    const root = await readFile(resolve(input, "source", rootPath), "utf8");
    map.lanePaths = lanePaths(root);
    if (map.lanePaths.length !== 6) throw new Error("Expected six lane paths");
    const zones: typeof map.zones = [];
    for (const record of readEntityRecords(root, rootPath)) {
      const p = record.properties;
      if (
        p.classname !== "trigger_multiple" ||
        !/^\[PR#\]neutralcamp|^neutralcamp/.test(
          p.targetname ?? p.volumename ?? "",
        )
      )
        continue;
      const name = basename(
        (p.model ?? "")
          .replace(/^resource_name:/, "")
          .replaceAll('"', "")
          .replaceAll("\\", "/"),
      ).replace(/\.vmdl(?:_c)?$/, ".vmdl_c.txt");
      zones.push(
        ...campHulls(
          await readFile(resolve(input, "source/hull-dumps", name), "utf8"),
          p,
          record.id,
        ),
      );
    }
    if (zones.length !== map.zones.length)
      throw new Error("Spawn volume count changed");
    map.zones = zones;
    for (const camp of map.economy.camps)
      if (!zones.some((z) => z.label.replace(/^\[PR#\]/, "") === camp.name))
        throw new Error(`Missing camp volume: ${camp.name}`);
    const after = await Promise.all([fileSha256(vpk), fileSha256(archive)]);
    if (
      before.some((v, i) => v !== after[i]) ||
      !steamBytes.equals(await readFile(resolve(game, "steam.inf")))
    )
      throw new Error("Game updated during extraction");
    await writeFile(
      resolve(evidence, "import.json"),
      JSON.stringify(
        {
          source_repository: "steam:570",
          source_commit: null,
          client_version: steam.clientVersion,
          source_path: paths,
          imported_at: new Date().toISOString(),
          importer_version: "map-economy/2",
          schema_version: "map-economy-v1",
          input_map_sha256: sha256(mapBytes),
          archives_sha256: before,
          cli_version: (await exec(cli, ["--version"])).stdout.trim(),
          cli_sha256: await fileSha256(cli),
        },
        null,
        2,
      ),
    );
    for (const path of await listFiles(evidence)) {
      const f = {
        path: `economy/${path}`,
        sha256: await fileSha256(resolve(evidence, path)),
      };
      map.provenance.files.push(f);
      map.provenance.source_path.push(f.path);
    }
    map.provenance.importer_version = "local-map/1+map-economy/2";
    map.provenance.imported_at = new Date().toISOString();
    const result = mapPackageSchema.parse(map);
    await writeFile(resolve(staging, "map.json"), JSON.stringify(result));
    await rename(staging, output);
    console.log(
      JSON.stringify(
        {
          output,
          camps: result.economy!.camps.length,
          groups: result.economy!.groups.length,
          units: Object.keys(result.economy!.units).length,
          volumes: result.zones.length,
          lanePaths: result.lanePaths.length,
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
