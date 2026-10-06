import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { syncRoot } from "@/config/data-sync-state";
import { atomicJson } from "./files";
import {
  configureRepository,
  dataGit,
  fetchSnapshot,
  readDataLock,
} from "./git";
import { taskProcess, type exportDatabase } from "./tasks";
import { bundleSnapshot } from "./bundle";
import { dataLockSchema } from "./protocol";

const execute = promisify(execFile);
export async function codeGit(args: string[]) {
  return (
    await execute("git", args, {
      maxBuffer: 16 * 1024 * 1024,
      timeout: args[0] === "push" ? 900_000 : 300_000,
    })
  ).stdout.trim();
}
export async function exportCurrent(root = resolve(syncRoot(), "export")) {
  return taskProcess<Awaited<ReturnType<typeof exportDatabase>>>("export", [
    "--root",
    root,
  ]);
}

/** Never send assets to a public repository, even if local remote configuration changed. */
async function assertPrivateRemote(remote: string) {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(
      remote,
    );
  if (!match)
    throw new Error(
      "Automatic data publication currently requires a private GitHub repository.",
    );
  let token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    const credentials = await new Promise<string>((accept, reject) => {
      const child = execFile(
        "git",
        ["credential", "fill"],
        { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, timeout: 30_000 },
        (error, stdout) =>
          error
            ? reject(
                new Error(
                  "Cannot verify data repository privacy with Git credentials.",
                ),
              )
            : accept(stdout),
      );
      child.stdin!.end("protocol=https\nhost=github.com\n\n");
    });
    token = credentials
      .split(/\r?\n/)
      .find((line) => line.startsWith("password="))
      ?.slice(9);
  }
  if (!token)
    throw new Error(
      "GitHub credentials are required to verify private data publication.",
    );
  const response = await fetch(`https://api.github.com/repos/${match[1]}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (
    !response.ok ||
    ((await response.json()) as { private?: boolean }).private !== true
  )
    throw new Error(
      "Data publication requires a verified private repository; no assets uploaded.",
    );
}

export async function publishData() {
  const dirty = await codeGit(["status", "--porcelain"]);
  if (
    dirty
      .split(/\r?\n/)
      .some((line) => line && !line.endsWith(" dev-data.lock.json"))
  )
    throw new Error(
      "Commit code changes before publishing data so its manifest records the implemented exporter commit.",
    );
  const remote = await configureRepository();
  await assertPrivateRemote(remote);
  const current = await exportCurrent(
    resolve(syncRoot(), "publication-exports", randomUUID()),
  );
  const previous = await readDataLock();
  if (previous?.snapshotId === current.snapshotId) {
    await fetchSnapshot(previous);
    return { lock: previous, changed: false };
  }
  const bundle = await bundleSnapshot(
    current.root,
    current.snapshotId,
    resolve(current.root, "bundle"),
  );
  console.log(
    `Publishing ${bundle.bytes} bytes, ${current.manifest.objects.length} objects; snapshot ${current.snapshotId}.`,
  );
  const root = resolve(syncRoot(), "publish", current.snapshotId);
  await mkdir(root, { recursive: true });
  const git = (args: string[]) => dataGit(args, root);
  if (!existsSync(resolve(root, ".git"))) {
    await codeGit(["init", root]);
    await git(["remote", "add", "origin", remote]);
  }
  if ((await git(["remote", "get-url", "origin"])) !== remote)
    throw new Error("Publication checkout has another remote.");
  await git(["lfs", "install", "--local", "--skip-repo"]);
  // Snapshot branches never move; retries recover the exact already-published commit.
  const ref = `refs/heads/snapshots/${current.snapshotId}`;
  const existing = await git(["ls-remote", "origin", ref]);
  const localCandidate = await git(["rev-parse", "--verify", ref]).catch(() => null);
  let commit: string;
  if (existing) {
    commit = existing.split(/\s/)[0];
  } else if (localCandidate) {
    if (await git(["status", "--porcelain"])) throw new Error("Preserve pending changes in the publication checkout before retrying.");
    await git(["checkout", ref]);
    commit = localCandidate;
    await git(["lfs", "push", "origin", ref]);
    await git(["push", "origin", `${ref}:${ref}`]);
  } else {
    if (await git(["status", "--porcelain"]))
      throw new Error(
        `Publication checkout has pending changes: ${root}. Inspect and preserve before retrying.`,
      );
    if (previous) {
      await git(["fetch", "--no-tags", "origin", previous.commit]);
      await git(["lfs", "fetch", "origin", previous.commit]);
      await git(["checkout", "--detach", previous.commit]);
    }
    // Copy only the verified bundle, preserving all earlier content-addressed files.
    const paths = [
      ".gitattributes",
      "README.md",
      `snapshots/${current.snapshotId}/manifest.json`,
      ...current.manifest.tables.flatMap((table) =>
        table.chunks.map((c) => `tables/${c.sha256}.ndjson`),
      ),
      ...current.manifest.objects.map((o) => `objects/${o.sha256}`),
    ];
    const { writeFile } = await import("node:fs/promises");
    for (const path of new Set(paths)) {
      const target = resolve(root, path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(
        target,
        await readFile(resolve(bundle.destination, path)),
      );
    }
    for (const key of ["user.name", "user.email"])
      await git([
        "config",
        "--local",
        key,
        await codeGit(["config", "--get", key]),
      ]);
    await git([
      "add",
      "--",
      ".gitattributes",
      "README.md",
      "snapshots",
      "tables",
      "objects",
    ]);
    await git([
      "commit",
      "-m",
      `Publish development snapshot ${current.snapshotId}`,
    ]);
    commit = await git(["rev-parse", "HEAD"]);
    // Git LFS 3.x needs a named local ref, even when the commit itself is valid.
    await git(["update-ref", ref, commit, "0".repeat(40)]);
    await git(["lfs", "push", "origin", ref]);
    await git(["push", "origin", `${ref}:${ref}`]);
  }
  // A fresh checkout/LFS store proves the server can supply every byte, not just our export cache.
  const verificationRoot = resolve(
    syncRoot(),
    "remote-verification",
    randomUUID(),
  );
  await mkdir(verificationRoot, { recursive: true });
  await codeGit(["init", verificationRoot]);
  await dataGit(["remote", "add", "origin", remote], verificationRoot);
  await dataGit(
    ["fetch", "--no-tags", "--depth=1", "origin", commit],
    verificationRoot,
  );
  await dataGit(["checkout", "--detach", commit], verificationRoot);
  const { readSnapshot } = await import("./snapshot");
  const saved = await readSnapshot(verificationRoot, current.snapshotId);
  const lock = dataLockSchema.parse({
    version: 1,
    repository: "medota2-development-data",
    commit,
    snapshotId: current.snapshotId,
    manifestSha256: saved.manifestSha256,
    schemaDigest: saved.manifest.schemaDigest,
    migrationsDigest: saved.manifest.migrationsDigest,
  });
  await fetchSnapshot(lock, { root: verificationRoot });
  if ((await exportCurrent()).snapshotId !== current.snapshotId)
    throw new Error(
      "Local data changed during publication. Uploaded candidate is retained; retry before updating the code lock.",
    );
  await atomicJson(resolve("dev-data.lock.json"), lock);
  await atomicJson(resolve(syncRoot(), "last-publication.json"), {
    lock,
    verificationRoot,
    verifiedAt: new Date().toISOString(),
  });
  return { lock, changed: true };
}
