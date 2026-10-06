import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { syncRoot, assertOwnedPath } from "@/config/data-sync-state";
import { readJson } from "@/development/runtime";
import { atomicJson } from "./files";
import { readSnapshot, verifySnapshotFiles } from "./snapshot";
import { dataLockSchema, type DataLock } from "./protocol";
const execute = promisify(execFile);
export const repositoryRoot = () => resolve(syncRoot(), "repository");
const gitEnv = () => ({
  ...process.env,
  GIT_LFS_SKIP_SMUDGE: "1",
  GIT_TERMINAL_PROMPT: "0",
});
export async function dataGit(args: string[], root = repositoryRoot()) {
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
        ...args,
      ],
      { env: gitEnv(), maxBuffer: 16 * 1024 * 1024, timeout: 300_000 },
    )
  ).stdout.trim();
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
  options: { repository?: string; offline?: boolean; root?: string } = {},
) {
  const root = assertOwnedPath(options.root ?? repositoryRoot());
  const git = (args: string[]) => dataGit(args, root);
  if (!options.offline) {
    const remote = await configureRepository(options.repository);
    await mkdir(root, { recursive: true });
    if (!existsSync(resolve(root, ".git"))) {
      await execute("git", ["init", root], { env: gitEnv() });
      await git(["remote", "add", "origin", remote]);
      // Configure LFS filters without installing hooks or changing global Git settings.
      await git(["lfs", "install", "--local", "--skip-repo"]);
    } else {
      const actual = await git(["remote", "get-url", "origin"]);
      if (actual !== remote)
        throw new Error("Managed checkout has an unexpected remote.");
      await git(["lfs", "install", "--local", "--skip-repo"]);
      if (await git(["status", "--porcelain"]))
        throw new Error(
          "Managed data checkout has local changes; preserve them before fetching.",
        );
    }
    await git(["fetch", "--no-tags", "--depth=1", "origin", lock.commit]);
    if ((await git(["rev-parse", "FETCH_HEAD"])) !== lock.commit)
      throw new Error("Data remote returned another commit.");
    await git(["checkout", "--detach", lock.commit]);
  }
  if ((await git(["rev-parse", "HEAD"])) !== lock.commit)
    throw new Error("Cached data commit does not match the code lock.");
  const saved = await readSnapshot(root, lock.snapshotId, lock.manifestSha256);
  if (
    saved.manifest.schemaDigest !== lock.schemaDigest ||
    saved.manifest.migrationsDigest !== lock.migrationsDigest
  )
    throw new Error("Code lock metadata differs from its manifest.");
  if (!options.offline) {
    // Download just the content needed by this snapshot, with bounded argument size.
    for (let i = 0; i < saved.manifest.objects.length; i += 100) {
      const paths = saved.manifest.objects
        .slice(i, i + 100)
        .map((file) => `objects/${file.sha256}`);
      await git([
        "lfs",
        "pull",
        "origin",
        `--include=${paths.join(",")}`,
        "--exclude=",
      ]);
      console.log(
        `Downloaded ${Math.min(i + 100, saved.manifest.objects.length)}/${saved.manifest.objects.length} objects; full checksum verification follows.`,
      );
    }
  }
  const verification = await verifySnapshotFiles(root, saved.manifest);
  return { root, ...saved, ...verification };
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
    (await git(["status", "--porcelain"]))
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
