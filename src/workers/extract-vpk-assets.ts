import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  opendir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { availableParallelism } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { loadLocalEnv } from "@/config/env";
import {
  VALVE_ASSET_EXTRACTION_MANIFEST_FILE,
  VALVE_ASSET_EXTRACTION_SCHEMA,
  VALVE_ASSET_EXTRACTION_SCHEMA_VERSION,
  VALVE_ASSET_TEXTURE_DECODE_FLAGS,
  VALVE_ASSET_VPK_EXTENSIONS,
  VALVE_ASSET_VPK_PATH_FILTERS,
  type ValveAssetExtractionManifest,
} from "@/importers/valve-assets/extraction-manifest";

export const SOURCE2VIEWER_VPK_PATH_FILTERS = VALVE_ASSET_VPK_PATH_FILTERS;

export const DEFAULT_SOURCE2VIEWER_THREADS = Math.min(
  8,
  Math.max(1, availableParallelism()),
);

export interface VpkAssetExtractionConfig {
  cliPath: string;
  clientVersion: string;
  outputPath: string;
  threads: number;
  vpkPath: string;
}

export interface VpkAssetExtractionEnv {
  [key: string]: string | undefined;
  DOTA_VALVE_ASSET_CLIENT_VERSION?: string;
  DOTA_VALVE_ASSET_PATH?: string;
  DOTA_VPK_PATH?: string;
  SOURCE2VIEWER_CLI_PATH?: string;
}

export interface VpkAssetExtractionDependencies {
  now?: () => Date;
  spawnProcess?: SpawnSource2Viewer;
}

export type SpawnSource2Viewer = typeof spawn;

export function resolveVpkAssetExtractionConfig(
  argv: string[],
  env: VpkAssetExtractionEnv = process.env,
  cwd = process.cwd(),
): VpkAssetExtractionConfig {
  return {
    vpkPath: resolveRequiredPath(argv, "vpk", env.DOTA_VPK_PATH, cwd),
    cliPath: resolveRequiredPath(argv, "cli", env.SOURCE2VIEWER_CLI_PATH, cwd),
    outputPath: resolveRequiredPath(
      argv,
      "output",
      env.DOTA_VALVE_ASSET_PATH,
      cwd,
    ),
    clientVersion: resolveRequiredValue(
      argv,
      "client-version",
      env.DOTA_VALVE_ASSET_CLIENT_VERSION,
      "DOTA_VALVE_ASSET_CLIENT_VERSION",
    ),
    threads: DEFAULT_SOURCE2VIEWER_THREADS,
  };
}

export function buildSource2ViewerArgs(
  config: Pick<VpkAssetExtractionConfig, "outputPath" | "threads" | "vpkPath">,
): string[] {
  if (!Number.isSafeInteger(config.threads) || config.threads < 1) {
    throw new Error("Source2Viewer thread count must be a positive integer.");
  }

  return [
    "--input",
    config.vpkPath,
    "--output",
    config.outputPath,
    "-d",
    "--vpk_extensions",
    VALVE_ASSET_VPK_EXTENSIONS.join(","),
    "--vpk_filepath",
    VALVE_ASSET_VPK_PATH_FILTERS.join(","),
    "--texture_decode_flags",
    VALVE_ASSET_TEXTURE_DECODE_FLAGS,
    "--threads",
    String(config.threads),
  ];
}

export async function extractVpkAssets(
  config: VpkAssetExtractionConfig,
  dependencies: VpkAssetExtractionDependencies = {},
): Promise<ValveAssetExtractionManifest> {
  validateClientVersion(config.clientVersion);
  await assertPathAbsent(config.outputPath);

  const outputParent = dirname(config.outputPath);
  const outputName = basename(config.outputPath);
  if (!outputName || outputParent === config.outputPath) {
    throw new Error("Valve asset output must be a new, named directory.");
  }

  const [vpkDetails, cliDetails] = await Promise.all([
    requireRegularFile(config.vpkPath, "Dota VPK"),
    requireRegularFile(config.cliPath, "Source2Viewer-CLI"),
  ]);
  const vpkDirectory = dirname(vpkDetails.realPath);
  const prospectiveOutputPath = await resolveProspectiveRealPath(
    config.outputPath,
  );
  if (pathIsWithin(vpkDirectory, prospectiveOutputPath)) {
    throw new Error(
      "Valve asset output must be outside the source VPK directory.",
    );
  }

  await mkdir(outputParent, { recursive: true });
  const realOutputParent = await realpath(outputParent);
  if (pathIsWithin(vpkDirectory, join(realOutputParent, outputName))) {
    throw new Error(
      "Valve asset output must be outside the source VPK directory.",
    );
  }

  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const [vpkSha256, source2ViewerVersion] = await Promise.all([
    sha256File(vpkDetails.realPath),
    readSource2ViewerVersion(cliDetails.realPath, spawnProcess),
  ]);
  const stagingPath = await mkdtemp(
    join(realOutputParent, `.${outputName}.staging-`),
  );
  let finalized = false;

  try {
    const extractionConfig = {
      ...config,
      cliPath: cliDetails.realPath,
      outputPath: stagingPath,
      vpkPath: vpkDetails.realPath,
    };
    const args = buildSource2ViewerArgs(extractionConfig);
    await runSource2Viewer(cliDetails.realPath, args, spawnProcess);
    const extractedFileCount = await countExtractedFiles(stagingPath);
    if (extractedFileCount === 0) {
      throw new Error(
        "Source2Viewer-CLI completed without extracting any asset files.",
      );
    }

    const manifest: ValveAssetExtractionManifest = {
      schema: VALVE_ASSET_EXTRACTION_SCHEMA,
      schemaVersion: VALVE_ASSET_EXTRACTION_SCHEMA_VERSION,
      clientVersion: config.clientVersion,
      extractedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      vpk: {
        byteSize: vpkDetails.byteSize,
        sha256: vpkSha256,
      },
      source2Viewer: {
        version: source2ViewerVersion,
        arguments: args,
        filters: [...VALVE_ASSET_VPK_PATH_FILTERS],
        extensions: [...VALVE_ASSET_VPK_EXTENSIONS],
        textureDecodeFlags: VALVE_ASSET_TEXTURE_DECODE_FLAGS,
        threads: config.threads,
      },
      extractedFileCount,
    };
    await writeFile(
      join(stagingPath, VALVE_ASSET_EXTRACTION_MANIFEST_FILE),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );

    await assertPathAbsent(config.outputPath);
    await rename(stagingPath, config.outputPath);
    finalized = true;
    return manifest;
  } finally {
    if (!finalized) {
      await rm(stagingPath, { force: true, recursive: true });
    }
  }
}

export async function readSource2ViewerVersion(
  cliPath: string,
  spawnProcess: SpawnSource2Viewer = spawn,
): Promise<string> {
  const result = await runCapturedProcess(cliPath, ["--version"], spawnProcess);
  const version = result.stdout.trim() || result.stderr.trim();
  if (!version) {
    throw new Error("Source2Viewer-CLI --version returned no version text.");
  }
  return version;
}

async function main(): Promise<void> {
  loadLocalEnv();
  const config = resolveVpkAssetExtractionConfig(process.argv.slice(2));
  const manifest = await extractVpkAssets(config);
  console.log(
    JSON.stringify(
      {
        source: config.vpkPath,
        output: config.outputPath,
        manifest: VALVE_ASSET_EXTRACTION_MANIFEST_FILE,
        clientVersion: manifest.clientVersion,
        vpkSha256: manifest.vpk.sha256,
        source2ViewerVersion: manifest.source2Viewer.version,
        filters: manifest.source2Viewer.filters,
        threads: manifest.source2Viewer.threads,
        extractedFileCount: manifest.extractedFileCount,
      },
      null,
      2,
    ),
  );
}

async function runSource2Viewer(
  cliPath: string,
  args: string[],
  spawnProcess: SpawnSource2Viewer,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnProcess(cliPath, args, {
        shell: false,
        stdio: "inherit",
      });
    } catch (error) {
      reject(withLaunchContext(cliPath, error));
      return;
    }

    child.once("error", (error) => {
      reject(withLaunchContext(cliPath, error));
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(source2ViewerExitError(code, signal));
    });
  });
}

async function runCapturedProcess(
  cliPath: string,
  args: string[],
  spawnProcess: SpawnSource2Viewer,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnProcess(cliPath, args, {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(withLaunchContext(cliPath, error));
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      reject(withLaunchContext(cliPath, error));
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }
      reject(source2ViewerExitError(code, signal));
    });
  });
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function countExtractedFiles(root: string): Promise<number> {
  const pending = [root];
  let count = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    for await (const entry of await opendir(directory)) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(
          `Source2Viewer output contains an unexpected symbolic link: ${path}`,
        );
      }
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) count += 1;
    }
  }
  return count;
}

async function requireRegularFile(
  path: string,
  label: string,
): Promise<{ byteSize: number; realPath: string }> {
  const details = await stat(path).catch(() => null);
  if (!details?.isFile()) {
    throw new Error(`${label} is not a readable regular file: ${path}`);
  }
  if (details.size === 0) {
    throw new Error(`${label} is empty: ${path}`);
  }
  return { byteSize: details.size, realPath: await realpath(path) };
}

async function resolveProspectiveRealPath(path: string): Promise<string> {
  let existingAncestor = resolve(path);
  const missingSegments: string[] = [];
  while (true) {
    try {
      const realAncestor = await realpath(existingAncestor);
      return resolve(realAncestor, ...missingSegments);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(existingAncestor);
      if (parent === existingAncestor) throw error;
      missingSegments.unshift(basename(existingAncestor));
      existingAncestor = parent;
    }
  }
}

async function assertPathAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    `Valve asset output already exists; choose a new versioned directory: ${path}`,
  );
}

function pathIsWithin(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent === "" ||
    (!pathFromParent.startsWith(`..${sep}`) &&
      pathFromParent !== ".." &&
      !isAbsolute(pathFromParent))
  );
}

function validateClientVersion(value: string): void {
  if (!/^\d+$/u.test(value)) {
    throw new Error("Dota ClientVersion must contain only decimal digits.");
  }
}

function resolveRequiredPath(
  argv: string[],
  argumentName: "cli" | "output" | "vpk",
  environmentValue: string | undefined,
  cwd: string,
): string {
  const argumentValue = readArgument(argv, argumentName);
  const value = argumentValue ?? environmentValue?.trim();
  if (!value) {
    const environmentName = {
      cli: "SOURCE2VIEWER_CLI_PATH",
      output: "DOTA_VALVE_ASSET_PATH",
      vpk: "DOTA_VPK_PATH",
    }[argumentName];
    throw new Error(
      `--${argumentName} <path> or ${environmentName} is required.`,
    );
  }
  return resolve(cwd, value);
}

function resolveRequiredValue(
  argv: string[],
  argumentName: string,
  environmentValue: string | undefined,
  environmentName: string,
): string {
  const value = readArgument(argv, argumentName) ?? environmentValue?.trim();
  if (!value) {
    throw new Error(
      `--${argumentName} <value> or ${environmentName} is required.`,
    );
  }
  validateClientVersion(value);
  return value;
}

function readArgument(argv: string[], name: string): string | null {
  const flag = `--${name}`;
  const index = argv.indexOf(flag);
  if (index < 0) return null;

  const value = argv[index + 1]?.trim();
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function source2ViewerExitError(
  code: number | null,
  signal: NodeJS.Signals | null,
): Error {
  const outcome =
    code === null
      ? `terminated by signal ${signal ?? "unknown"}`
      : `exited ${code}`;
  return new Error(`Source2Viewer-CLI ${outcome}.`);
}

function withLaunchContext(cliPath: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(
    `Could not launch Source2Viewer-CLI at ${cliPath}: ${message}`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
