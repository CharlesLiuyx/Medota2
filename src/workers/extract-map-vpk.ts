import { execFile, spawn } from "node:child_process";
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
import { basename, dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { argument, fileSha256, listFiles } from "@/importers/dota-map/files";
import { parseOverview } from "@/importers/dota-map/adapter";
import { parseSteamInf } from "@/importers/dota-vpk/steam";
const exec = promisify(execFile);
/** Offline extraction; the web process never launches the decoder. */
async function main() {
  const args = process.argv.slice(2);
  const vpk = await realpath(argument(args, "vpk"));
  const mapVpk = await realpath(argument(args, "map-vpk"));
  const cli = await realpath(argument(args, "cli"));
  const source = await realpath(argument(args, "source"));
  if (basename(vpk) !== "pak01_dir.vpk" || basename(mapVpk) !== "dota.vpk")
    throw new Error("Select pak01_dir.vpk and the standard dota.vpk map");
  const commit = argument(args, "commit"),
    output = resolve(argument(args, "output"));
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error("--commit must be a full Git SHA");
  if (!mapVpk.startsWith(dirname(vpk) + sep))
    throw new Error(
      "Map VPK must belong to the same game directory as pak01_dir.vpk",
    );
  try {
    await stat(output);
    throw new Error("Output directory already exists");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const readGit = async (path: string) =>
    (
      await exec("git", ["-C", source, "show", `${commit}:${path}`], {
        encoding: "buffer",
        maxBuffer: 1024 * 1024,
      })
    ).stdout;
  const [steam, overview, installedSteam] = await Promise.all([
    readGit("steam.inf"),
    readGit("resource/overviews/dota.txt"),
    readFile(resolve(dirname(vpk), "steam.inf")),
  ]);
  if (!steam.equals(installedSteam))
    throw new Error(
      "Installed steam.inf does not match the pinned source commit",
    );
  parseOverview(overview.toString("utf8"));
  const version = parseSteamInf(steam.toString("utf8"));
  const repository = (
    await exec("git", ["-C", source, "remote", "get-url", "origin"])
  ).stdout.trim();
  // Never serialize authenticated remote URLs into distributable provenance.
  if (/https?:\/\/[^/]*@/.test(repository))
    throw new Error("Source remote must not contain credentials");
  const toolVersion = (
    await exec(cli, ["--version"], { timeout: 10000 })
  ).stdout.trim();
  await mkdir(dirname(output), { recursive: true });
  const parent = await realpath(dirname(output));
  if (parent === dirname(vpk) || parent.startsWith(dirname(vpk) + sep))
    throw new Error("Output must be outside the game directory");
  const staging = await mkdtemp(resolve(parent, `.${basename(output)}-`));
  try {
    const before = await Promise.all([fileSha256(vpk), fileSha256(mapVpk)]);
    const run = async (argv: string[]) =>
      new Promise<void>((accept, reject) => {
        const child = spawn(cli, argv, { stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code) =>
          code === 0
            ? accept()
            : reject(new Error(`Source2Viewer exited ${code}`)),
        );
      });
    const commands = [
      [
        "--input",
        vpk,
        "--output",
        resolve(staging, "textures"),
        "-d",
        "--vpk_filepath",
        "materials/overviews/",
        "--vpk_extensions",
        "vmat_c,vtex_c",
        "--texture_decode_flags",
        "ForceLDR",
        "--threads",
        "4",
      ],
      [
        "--input",
        mapVpk,
        "--output",
        resolve(staging, "entities"),
        "-d",
        "--vpk_extensions",
        "vents_c",
        "--threads",
        "4",
      ],
    ];
    for (const command of commands) await run(command);
    const after = await Promise.all([fileSha256(vpk), fileSha256(mapVpk)]);
    if (
      before.some((hash, i) => hash !== after[i]) ||
      !steam.equals(await readFile(resolve(dirname(vpk), "steam.inf")))
    )
      throw new Error("Source changed during extraction");
    await writeFile(resolve(staging, "overview.txt"), overview);
    await writeFile(resolve(staging, "steam.inf"), steam);
    const paths = await listFiles(staging);
    if (
      !paths.some(
        (p) => p.startsWith("textures/") && /\.(png|tga|webp)$/i.test(p),
      ) ||
      !paths.some((p) => p.startsWith("entities/"))
    )
      throw new Error("No decoded map textures or entities found");
    const files = await Promise.all(
      paths.map(async (path) => ({
        path,
        sha256: await fileSha256(resolve(staging, path)),
      })),
    );
    await writeFile(
      resolve(staging, "extraction.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          source_repository: repository,
          source_commit: commit,
          client_version: version.clientVersion,
          extracted_at: new Date().toISOString(),
          source2viewer: toolVersion,
          archives: [
            { path: "pak01_dir.vpk", sha256: before[0] },
            { path: "maps/dota.vpk", sha256: before[1] },
          ],
          files,
        },
        null,
        2,
      ),
    );
    await rename(staging, output);
    console.log(
      `Extracted to ${output}. Inspect the current dota material texture reference and root entity lump before import.`,
    );
    console.log(
      paths
        .filter((p) => /\.(vmat|vents|txt|png|webp|tga)$/i.test(p))
        .join("\n"),
    );
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
