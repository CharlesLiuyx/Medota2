import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { argument, fileSha256, listFiles } from "@/importers/dota-map/files";
import { parseSteamInf } from "@/importers/dota-vpk/steam";
const exec = promisify(execFile);
async function main() {
  const args = process.argv.slice(2),
    vpk = await realpath(argument(args, "vpk")),
    mapVpk = await realpath(argument(args, "map-vpk"));
  const cli = await realpath(argument(args, "cli")),
    output = resolve(argument(args, "output"));
  if (
    basename(vpk) !== "pak01_dir.vpk" ||
    mapVpk !== (await realpath(resolve(dirname(vpk), "maps/dota.vpk")))
  )
    throw new Error(
      "Select the standard map and pak01_dir.vpk from the same installation",
    );
  try {
    await stat(output);
    throw new Error("Output directory already exists");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await mkdir(dirname(output), { recursive: true });
  const parent = await realpath(dirname(output)),
    fromGame = relative(dirname(vpk), parent);
  if (!fromGame || (!fromGame.startsWith("..") && !isAbsolute(fromGame)))
    throw new Error("Output must be outside game directory");
  const steam = await readFile(resolve(dirname(vpk), "steam.inf")),
    version = parseSteamInf(steam.toString("utf8"));
  const before = await Promise.all([fileSha256(vpk), fileSha256(mapVpk)]);
  const mapSha1 = createHash("sha1")
    .update(await readFile(mapVpk))
    .digest("hex");
  const tool = (
    await exec(cli, ["--version"], { timeout: 10000 })
  ).stdout.trim();
  const staging = await mkdtemp(resolve(parent, `.${basename(output)}-`));
  const commands: string[][] = [];
  const run = async (argv: string[]) => {
    commands.push(
      argv.map((a) =>
        a.replaceAll(staging, "<output>").replaceAll(dirname(vpk), "<game>"),
      ),
    );
    return (
      await exec(cli, argv, {
        cwd: staging,
        timeout: 120000,
        maxBuffer: 64 * 1024 * 1024,
      })
    ).stdout;
  };
  try {
    const verification = await run(["-i", mapVpk, "--vpk_verify"]);
    if (!/^Success\.\r?$/m.test(verification))
      throw new Error("Source 2 Viewer did not confirm VPK hash verification");
    for (const folder of ["overview", "entities", "raw", "hulls", "hull-dumps"])
      await mkdir(resolve(staging, folder));
    await run([
      "-i",
      vpk,
      "-o",
      resolve(staging, "overview"),
      "-d",
      "-f",
      "materials/overviews/dota.vmat_c,resource/overviews/dota.txt",
    ]);
    await run([
      "-i",
      mapVpk,
      "-o",
      resolve(staging, "entities"),
      "-d",
      "-e",
      "vents_c",
      "--threads",
      "4",
    ]);
    await run([
      "-i",
      mapVpk,
      "-o",
      resolve(staging, "raw"),
      "-e",
      "gnv,vhcg,trm,vwrld_c",
    ]);
    await run([
      "-i",
      mapVpk,
      "-o",
      resolve(staging, "hulls"),
      "-f",
      "maps/dota/entities/neutralcamp_",
      "-e",
      "vmdl_c",
    ]);
    for (const path of await listFiles(resolve(staging, "hulls"))) {
      const dump = await run([
        "-i",
        resolve(staging, "hulls", path),
        "-b",
        "PHYS",
      ]);
      await writeFile(
        resolve(staging, "hull-dumps", basename(path) + ".txt"),
        dump,
      );
    }
    await writeFile(resolve(staging, "steam.inf"), steam);
    await writeFile(resolve(staging, "vpk-verify.txt"), verification);
    const after = await Promise.all([fileSha256(vpk), fileSha256(mapVpk)]);
    if (
      before.some((hash, i) => hash !== after[i]) ||
      !steam.equals(await readFile(resolve(dirname(vpk), "steam.inf")))
    )
      throw new Error("Source changed during extraction");
    const files = await Promise.all(
      (await listFiles(staging)).map(async (path) => ({
        path,
        sha256: await fileSha256(resolve(staging, path)),
      })),
    );
    await writeFile(
      resolve(staging, "extraction.json"),
      JSON.stringify(
        {
          schemaVersion: 2,
          source_repository: "steam:570",
          source_commit: null,
          client_version: version.clientVersion,
          source_revision: version.sourceRevision,
          extracted_at: new Date().toISOString(),
          source2viewer: tool,
          source2viewer_sha256: await fileSha256(cli),
          map_sha1: mapSha1,
          map_vpk_verified: true,
          archives: [
            { path: "pak01_dir.vpk", sha256: before[0] },
            { path: "maps/dota.vpk", sha256: before[1] },
          ],
          files,
          commands,
        },
        null,
        2,
      ),
    );
    await rename(staging, output);
    console.log(
      `Extracted ${files.length} files to ${output}; client ${version.clientVersion}; map ${mapSha1}`,
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
