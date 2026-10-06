import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  lstat,
  rm,
} from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { syncRoot, assertOwnedPath } from "@/config/data-sync-state";
import { readJson } from "@/development/runtime";
import { atomicJson } from "./files";
import { readSnapshot, verifySnapshotFiles } from "./snapshot";
import { dataLockSchema, type DataLock } from "./protocol";
import { type SnapshotManifest } from "./protocol";
import { blobPath, verifiedFile } from "./files";
import { timed } from "./timing";
const execute = promisify(execFile);
export const repositoryRoot = () => resolve(syncRoot(), "repository");
export async function hasManagedChanges(
  git: (args: string[]) => Promise<string>,
) {
  if (await git(["ls-files", "--others", "--exclude-standard"])) return true;
  try {
    // Older Git/LFS can report hydrated files as modified from their cached size.
    // Compare filtered content, including staged changes, instead of stat-only status.
    await git(["diff", "--quiet", "--no-ext-diff"]);
    await git(["diff", "--cached", "--quiet", "--no-ext-diff"]);
    return false;
  } catch {
    return true;
  }
}
const gitEnv = () => ({
  ...process.env,
  GIT_LFS_SKIP_SMUDGE: "1",
  GIT_TERMINAL_PROMPT: "0",
});
export async function dataGit(
  args: string[],
  root = repositoryRoot(),
  isolatedLfs = false,
) {
  return (
    await execute(
      "git",
      [
        "-C",
        root,
        "-c",
        `core.hooksPath=${resolve(root, ".git", "disabled-hooks")}`,
        "-c",
        "core.autocrlf=false",
        "-c",
        `lfs.storage=${resolve(isolatedLfs ? root : repositoryRoot(), ".git/lfs")}`,
        ...args,
      ],
      {
        env: gitEnv(),
        maxBuffer: 16 * 1024 * 1024,
        timeout:
          args.includes("lfs") &&
          (args.includes("fetch") || args.includes("push"))
            ? 900_000
            : 300_000,
      },
    )
  ).stdout.trim();
}

async function quarantine(path: string) {
  assertOwnedPath(path);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink())
    throw new Error("Cannot repair a non-regular cache object.");
  const destination = resolve(syncRoot(), "corrupt-cache", randomUUID());
  await mkdir(destination, { recursive: true });
  await rename(path, resolve(destination, "object"));
  await atomicJson(resolve(destination, "receipt.json"), {
    originalPath: path,
    preservedAt: new Date().toISOString(),
  });
}

async function preserveCheckoutChanges(
  root: string,
  git: (args: string[]) => Promise<string>,
) {
  if (!(await hasManagedChanges(git))) return;
  // Content-addressed cache objects are immutable. Preserve damaged bytes before repairing them.
  if (await git(["ls-files", "--others", "--exclude-standard"]))
    throw new Error(
      "Managed data checkout has untracked files; preserve them before fetching.",
    );
  await git(["diff", "--cached", "--quiet", "--no-ext-diff"]).catch(() => {
    throw new Error(
      "Managed data checkout has staged changes; preserve them before fetching.",
    );
  });
  const paths = (await git(["diff", "--name-only", "--no-ext-diff"]))
    .split(/\r?\n/)
    .filter(Boolean);
  if (
    !paths.length ||
    paths.some((path) => !/^objects\/[a-f0-9]{64}$/.test(path))
  )
    throw new Error(
      "Managed data checkout has local changes; preserve them before fetching.",
    );
  for (const path of paths) {
    const pointer = await git(["show", `HEAD:${path}`]);
    if (!pointer.includes(`oid sha256:${path.slice(8)}`))
      throw new Error("Modified file is not a managed LFS object.");
    const full = assertOwnedPath(resolve(root, path));
    if (existsSync(full)) await quarantine(full);
    await git(["checkout", "--", path]);
  }
}

export async function hydrateSnapshotObjects(
  root: string,
  manifest: SnapshotManifest,
  commit: string,
  isolatedLfs = false,
) {
  const git = (args: string[]) => dataGit(args, root, isolatedLfs);
  const storage = resolve(
    isolatedLfs ? root : repositoryRoot(),
    ".git/lfs/objects",
  );
  const missing: SnapshotManifest["objects"] = [];
  const verifiedObjects = new Map<string, Buffer>();
  let local = 0,
    cached = 0;
  async function fromLfs(file: SnapshotManifest["objects"][number]) {
    const path = assertOwnedPath(
      resolve(
        storage,
        file.sha256.slice(0, 2),
        file.sha256.slice(2, 4),
        file.sha256,
      ),
    );
    try {
      return await verifiedFile(path, file);
    } catch {
      if (existsSync(path)) await quarantine(path);
      return null;
    }
  }
  async function writeObject(
    file: SnapshotManifest["objects"][number],
    bytes: Buffer,
  ) {
    const path = blobPath(root, file.sha256);
    await mkdir(resolve(path, ".."), { recursive: true });
    if (existsSync(path)) {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink())
        throw new Error("Cannot hydrate a non-regular object.");
      const previous = await readFile(path);
      const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${file.sha256}\nsize ${file.bytes}\n`;
      if (previous.toString("utf8") !== pointer) await quarantine(path);
    }
    await writeFile(path, bytes);
  }
  for (const file of manifest.objects) {
    try {
      verifiedObjects.set(
        file.sha256,
        await verifiedFile(blobPath(root, file.sha256), file),
      );
      local++;
      continue;
    } catch {
      /* Repair below. */
    }
    const bytes = await fromLfs(file);
    if (bytes) {
      await writeObject(file, bytes);
      verifiedObjects.set(file.sha256, bytes);
      cached++;
    } else missing.push(file);
  }
  if (missing.length) {
    const config = resolve(syncRoot(), "lfs-fetch", `${randomUUID()}.config`);
    await mkdir(resolve(config, ".."), { recursive: true });
    // A config file avoids Windows argument limits for thousands of SHA paths.
    await writeFile(
      config,
      `[lfs]\nfetchinclude = ${missing.map((file) => `objects/${file.sha256}`).join(",")}\nfetchexclude =\nfetchrecentalways = false\nconcurrenttransfers = 16\n`,
    );
    try {
      await timed(`LFS fetch ${missing.length} missing objects`, () =>
        git(["-c", `include.path=${config}`, "lfs", "fetch", "origin", commit]),
      );
      for (const file of missing) {
        const bytes = await fromLfs(file);
        if (!bytes)
          throw new Error(
            `Remote LFS object is unavailable or corrupt: ${file.sha256}`,
          );
        await writeObject(file, bytes);
        verifiedObjects.set(file.sha256, bytes);
      }
    } finally {
      await rm(config, { force: true });
    }
  }
  const transfer = {
    localObjects: local,
    lfsCacheObjects: cached,
    missingObjects: missing.length,
    requestedBytes: missing.reduce((sum, file) => sum + file.bytes, 0),
    lfsFetchCalls: missing.length ? 1 : 0,
  };
  console.error(
    `[sync] objects: ${local} local, ${cached} LFS cache, ${missing.length} requested (${transfer.requestedBytes} bytes), ${transfer.lfsFetchCalls} LFS fetch`,
  );
  return { ...transfer, verifiedObjects };
}
export async function configureRepository(value?: string): Promise<string> {
  const path = resolve(syncRoot(), "repository.json");
  const saved = await readJson<{ url: string }>(path);
  const url = value || process.env.MEDOTA2_DATA_REPOSITORY || saved?.url;
  if (!url)
    throw new Error(
      "Set MEDOTA2_DATA_REPOSITORY or pass --repository with the private data Git remote.",
    );
  // The remote is explicit local configuration, never taken from a data manifest.
  if (/\s|[\r\n]/.test(url) || url.startsWith("-"))
    throw new Error("Invalid data repository.");
  if (/^https?:/.test(url)) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      throw new Error(
        "Use HTTPS without embedded credentials, or an authenticated SSH Git URL.",
      );
  }
  if (saved && saved.url !== url)
    throw new Error(
      "Data repository differs from the configured workspace remote.",
    );
  if (!saved) await atomicJson(path, { url });
  return url;
}
export async function readDataLock(): Promise<DataLock | null> {
  try {
    return dataLockSchema.parse(
      JSON.parse(await readFile(resolve("dev-data.lock.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function fetchSnapshot(
  lock: DataLock,
  options: {
    repository?: string;
    offline?: boolean;
    root?: string;
    isolatedLfs?: boolean;
  } = {},
) {
  const root = assertOwnedPath(options.root ?? repositoryRoot());
  const git = (args: string[]) => dataGit(args, root, options.isolatedLfs);
  if (!options.offline) {
    const remote = await configureRepository(options.repository);
    await mkdir(root, { recursive: true });
    if (!existsSync(resolve(root, ".git/HEAD"))) {
      await execute("git", ["init", root], { env: gitEnv() });
      await git(["remote", "add", "origin", remote]);
      // Configure LFS filters without installing hooks or changing global Git settings.
      await git(["lfs", "install", "--local", "--skip-repo"]);
    } else {
      const actual = await git(["remote", "get-url", "origin"]);
      if (actual !== remote)
        throw new Error("Managed checkout has an unexpected remote.");
      await git(["lfs", "install", "--local", "--skip-repo"]);
      await preserveCheckoutChanges(root, git);
    }
    const head = await git(["rev-parse", "HEAD"]).catch(() => null);
    if (head !== lock.commit) {
      await git(["fetch", "--no-tags", "--depth=1", "origin", lock.commit]);
      if ((await git(["rev-parse", "FETCH_HEAD"])) !== lock.commit)
        throw new Error("Data remote returned another commit.");
      await git(["checkout", "--detach", lock.commit]);
    }
  }
  if ((await git(["rev-parse", "HEAD"])) !== lock.commit)
    throw new Error("Cached data commit does not match the code lock.");
  const saved = await readSnapshot(root, lock.snapshotId, lock.manifestSha256);
  if (
    saved.manifest.schemaDigest !== lock.schemaDigest ||
    saved.manifest.migrationsDigest !== lock.migrationsDigest
  )
    throw new Error("Code lock metadata differs from its manifest.");
  const hydrated = !options.offline
    ? await hydrateSnapshotObjects(
        root,
        saved.manifest,
        lock.commit,
        options.isolatedLfs,
      )
    : undefined;
  const verification = await verifySnapshotFiles(
    root,
    saved.manifest,
    hydrated?.verifiedObjects,
  );
  const transfer = hydrated
    ? {
        localObjects: hydrated.localObjects,
        lfsCacheObjects: hydrated.lfsCacheObjects,
        missingObjects: hydrated.missingObjects,
        requestedBytes: hydrated.requestedBytes,
        lfsFetchCalls: hydrated.lfsFetchCalls,
      }
    : undefined;
  return { root, ...saved, ...verification, transfer };
}

export async function lockPublishedSnapshot(
  commit: string,
  id: string,
  repository?: string,
): Promise<DataLock> {
  // Fetch the manifest before constructing its hash, then verify all payloads.
  const remote = await configureRepository(repository);
  const root = repositoryRoot();
  const git = (args: string[]) => dataGit(args, root);
  await mkdir(root, { recursive: true });
  if (!existsSync(resolve(root, ".git"))) {
    await execute("git", ["init", root]);
    await git(["remote", "add", "origin", remote]);
  }
  await git(["lfs", "install", "--local", "--skip-repo"]);
  if (
    (await git(["remote", "get-url", "origin"])) !== remote ||
    (await hasManagedChanges(git))
  )
    throw new Error(
      "Managed data checkout is not clean or has a different remote.",
    );
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new Error("Pass a complete published data commit.");
  await git(["fetch", "--no-tags", "--depth=1", "origin", commit]);
  await git(["checkout", "--detach", commit]);
  const saved = await readSnapshot(root, id);
  const lock = dataLockSchema.parse({
    version: 1,
    repository: "medota2-development-data",
    commit,
    snapshotId: id,
    manifestSha256: saved.manifestSha256,
    schemaDigest: saved.manifest.schemaDigest,
    migrationsDigest: saved.manifest.migrationsDigest,
  });
  await fetchSnapshot(lock, { repository: remote });
  await atomicJson(resolve("dev-data.lock.json"), lock);
  return lock;
}
