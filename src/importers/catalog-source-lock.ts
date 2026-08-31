import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { loadLocalEnv, getRequiredPath } from "@/config/env";
import {
  CATALOG_SELECTOR_VERSION,
  CATALOG_STATIC_SOURCE_PATHS,
  HERO_ABILITY_SOURCE_PATTERN,
  HERO_ABILITY_SOURCE_PREFIX,
  VPK_SOURCE_REPOSITORY,
} from "@/importers/dota-vpk/constants";
import { canonicalJsonSha256, sha256 } from "@/lib/hash";
import { assertOutboundNetworkAllowed } from "@/config/network-policy";

const execFileAsync = promisify(execFile);
const sha = /^[0-9a-f]{40}$/u;

const lockSchema = z.object({
  version: z.literal(1),
  sourceRepository: z.literal(VPK_SOURCE_REPOSITORY),
  remoteUrl: z.string().min(1),
  commit: z.string().regex(sha),
  selectorVersion: z.literal(CATALOG_SELECTOR_VERSION),
  selectorManifestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  clientVersion: z.string().min(1),
  sourceRevision: z.string().min(1),
  createdAt: z.string().datetime(),
  files: z.array(
    z.object({
      path: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      sizeBytes: z.number().int().nonnegative(),
    }),
  ),
});

export type CatalogSourceLock = z.infer<typeof lockSchema>;

export interface CatalogSourceConfig {
  remoteUrl: string;
  mirrorPath: string;
  worktreeRoot: string;
  lockRoot: string;
}

export async function getCatalogSourceConfig(): Promise<CatalogSourceConfig> {
  loadLocalEnv();
  const configuredRemote = process.env.DOTA_VPK_REMOTE_URL?.trim();
  const remoteUrl = configuredRemote
    ? configuredRemote
    : await gitText(getRequiredPath("DOTA_VPK_UPDATES_PATH"), [
        "remote",
        "get-url",
        "origin",
      ]);
  return {
    remoteUrl,
    mirrorPath: resolve(
      process.cwd(),
      process.env.DOTA_VPK_MIRROR_PATH?.trim() || ".medota2/cache/dota-vpk.git",
    ),
    worktreeRoot: resolve(
      process.cwd(),
      process.env.DOTA_VPK_WORKTREE_ROOT?.trim() || ".medota2/cache/worktrees",
    ),
    lockRoot: resolve(
      process.cwd(),
      process.env.DOTA_VPK_LOCK_ROOT?.trim() || ".medota2/locks",
    ),
  };
}

export async function discoverRemoteCommit(remoteUrl: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-remote", remoteUrl, "HEAD"],
    {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    },
  );
  const commit = stdout.trim().split(/\s+/u)[0];
  if (!sha.test(commit)) {
    throw new Error(
      `Remote HEAD did not resolve to a full commit: ${remoteUrl}`,
    );
  }
  return commit;
}

export async function createCatalogSourceLock(
  commit: string,
  outputPath?: string,
): Promise<{ lock: CatalogSourceLock; path: string }> {
  if (!sha.test(commit)) throw new Error(`Invalid source commit: ${commit}`);
  const config = await getCatalogSourceConfig();
  await ensureMirror(config, true);
  await gitText(
    config.mirrorPath,
    ["cat-file", "-e", `${commit}^{commit}`],
    true,
  );
  const tree = await gitText(config.mirrorPath, [
    "ls-tree",
    "-r",
    "--name-only",
    commit,
    "--",
    HERO_ABILITY_SOURCE_PREFIX,
  ]);
  const dynamicPaths = tree
    .split("\n")
    .filter((path) => HERO_ABILITY_SOURCE_PATTERN.test(path))
    .sort(byteSort);
  if (dynamicPaths.length === 0) {
    throw new Error(`Commit ${commit} has no selected Hero Ability files.`);
  }
  const paths = [...CATALOG_STATIC_SOURCE_PATHS, ...dynamicPaths].sort(
    byteSort,
  );
  const files = [];
  let steamText = "";
  for (const path of paths) {
    const bytes = await gitBytes(config.mirrorPath, [
      "show",
      `${commit}:${path}`,
    ]);
    files.push({ path, sha256: sha256(bytes), sizeBytes: bytes.byteLength });
    if (path === "steam.inf") steamText = new TextDecoder().decode(bytes);
  }
  const clientVersion = /^ClientVersion=(.+)$/mu.exec(steamText)?.[1]?.trim();
  const sourceRevision = /^SourceRevision=(.+)$/mu.exec(steamText)?.[1]?.trim();
  if (!clientVersion || !sourceRevision) {
    throw new Error(`Commit ${commit} has an invalid steam.inf.`);
  }
  const manifest = files
    .map((file) => `${file.path}\t${file.sha256}\t${file.sizeBytes}\n`)
    .join("");
  const lock: CatalogSourceLock = {
    version: 1,
    sourceRepository: VPK_SOURCE_REPOSITORY,
    remoteUrl: config.remoteUrl,
    commit,
    selectorVersion: CATALOG_SELECTOR_VERSION,
    selectorManifestSha256: canonicalJsonSha256(dynamicPaths),
    manifestSha256: sha256(Buffer.from(manifest)),
    clientVersion,
    sourceRevision,
    createdAt: new Date().toISOString(),
    files,
  };
  const path = resolve(
    process.cwd(),
    outputPath || `${config.lockRoot}/vpk-${commit}.json`,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  }).catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
    const existing = await loadCatalogSourceLock(path);
    if (
      canonicalJsonSha256({ ...existing, createdAt: lock.createdAt }) !==
      canonicalJsonSha256(lock)
    ) {
      throw new Error(`Existing source lock differs: ${path}`);
    }
  });
  return { lock, path };
}

export async function loadCatalogSourceLock(
  pathInput: string,
): Promise<CatalogSourceLock> {
  const path = resolve(process.cwd(), pathInput);
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  return lockSchema.parse(parsed);
}

export async function prepareCatalogSourceWorktree(
  lock: CatalogSourceLock,
): Promise<string> {
  const config = await getCatalogSourceConfig();
  await ensureMirror(config, false);
  const worktree = resolve(config.worktreeRoot, lock.commit);
  const exists = await stat(worktree).catch(() => null);
  if (!exists) {
    await mkdir(config.worktreeRoot, { recursive: true });
    await gitText(
      config.mirrorPath,
      ["worktree", "add", "--detach", worktree, lock.commit],
      true,
    );
  }
  const actual = await realpath(worktree);
  const head = await gitText(actual, ["rev-parse", "HEAD"]);
  if (head !== lock.commit) {
    throw new Error(`Locked worktree is at ${head}, expected ${lock.commit}.`);
  }
  return actual;
}

export function verifySnapshotAgainstLock(
  lock: CatalogSourceLock,
  snapshot: {
    commit: string;
    manifestSha256: string;
    files: Array<{ path: string; sha256: string; sizeBytes: number }>;
  },
): void {
  if (
    snapshot.commit !== lock.commit ||
    snapshot.manifestSha256 !== lock.manifestSha256
  ) {
    throw new Error(
      "Source checkout does not match the exact commit/manifest lock.",
    );
  }
  const normalize = (
    files: Array<{ path: string; sha256: string; sizeBytes: number }>,
  ) =>
    files
      .map(({ path, sha256, sizeBytes }) => ({ path, sha256, sizeBytes }))
      .sort((left, right) => byteSort(left.path, right.path));
  if (
    canonicalJsonSha256(normalize(snapshot.files)) !==
    canonicalJsonSha256(normalize(lock.files))
  ) {
    throw new Error("Source file list or blob checksums differ from the lock.");
  }
}

async function ensureMirror(
  config: CatalogSourceConfig,
  fetchRemote: boolean,
): Promise<void> {
  const exists = await stat(config.mirrorPath).catch(() => null);
  if (!exists) {
    assertOutboundNetworkAllowed(config.remoteUrl, "Catalog Git adapter");
    await mkdir(dirname(config.mirrorPath), { recursive: true });
    await gitText(
      process.cwd(),
      ["clone", "--mirror", config.remoteUrl, config.mirrorPath],
      true,
    );
  } else {
    const actualRemote = await gitText(config.mirrorPath, [
      "remote",
      "get-url",
      "origin",
    ]);
    if (actualRemote !== config.remoteUrl) {
      throw new Error(
        `Configured mirror origin mismatch: ${actualRemote} != ${config.remoteUrl}`,
      );
    }
  }
  if (fetchRemote) {
    assertOutboundNetworkAllowed(config.remoteUrl, "Catalog Git adapter");
    await gitText(config.mirrorPath, ["fetch", "--prune", "origin"], true);
  }
}

async function gitText(
  cwd: string,
  args: string[],
  allowEmpty = false,
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = stdout.trim();
  if (!output && !allowEmpty) {
    throw new Error(`Git returned empty output: git ${args.join(" ")}`);
  }
  return output;
}

function gitBytes(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
      (error, stdout) =>
        error ? reject(error) : resolvePromise(stdout as Buffer),
    );
  });
}

function byteSort(left: string, right: string): number {
  return Buffer.from(left).compare(Buffer.from(right));
}
