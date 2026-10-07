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
  hasManagedChanges,
} from "./git";
import { taskProcess, type exportDatabase } from "./tasks";
import { writePublicationMetadata } from "./bundle";
import { dataLockSchema, type SnapshotManifest } from "./protocol";
import { sha256 } from "./protocol";
import { mapDigest } from "./maps";
import type { inspectDatabase } from "./tasks";
import { timed } from "./timing";

const execute = promisify(execFile);

async function confirmCurrentData(manifest: SnapshotManifest) {
  const live = await timed("confirm current data after publication", () =>
    taskProcess<Awaited<ReturnType<typeof inspectDatabase>>>("inspect"),
  );
  if (
    live.databaseDigest !== manifest.databaseDigest ||
    live.mapDigest !== mapDigest(manifest.map)
  )
    throw new Error(
      "Local data changed during publication. Uploaded candidate is retained; retry before updating the code lock.",
    );
}
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
export async function assertPrivateRemote(remote: string) {
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

export async function publishData(
  options: { fullVerification?: boolean; expectedSnapshotId?: string } = {},
) {
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
  const current = await timed("export current data", () => exportCurrent());
  if (
    options.expectedSnapshotId &&
    current.snapshotId !== options.expectedSnapshotId
  )
    throw new Error(
      "Business data changed after candidate validation; preserve the uploaded candidate and revalidate before publishing.",
    );
  const previous = await readDataLock();
  if (
    previous?.snapshotId === current.snapshotId &&
    !options.fullVerification
  ) {
    await fetchSnapshot(previous);
    await confirmCurrentData(current.manifest);
    return { lock: previous, changed: false };
  }
  const bytes =
    current.manifest.objects.reduce((sum, object) => sum + object.bytes, 0) +
    current.manifest.tables
      .flatMap((table) => table.chunks)
      .reduce((sum, chunk) => sum + chunk.bytes, 0);
  console.log(
    `Publishing ${bytes} bytes, ${current.manifest.objects.length} objects; snapshot ${current.snapshotId}.`,
  );
  const root = resolve(syncRoot(), "publication-worktree");
  await mkdir(root, { recursive: true });
  const git = (args: string[]) => dataGit(args, root);
  if (!existsSync(resolve(root, ".git/HEAD"))) {
    await codeGit(["init", root]);
    await git(["remote", "add", "origin", remote]);
  }
  if ((await git(["remote", "get-url", "origin"])) !== remote)
    throw new Error("Publication checkout has another remote.");
  await git(["lfs", "install", "--local", "--skip-repo"]);
  // Snapshot branches never move; retries recover the exact already-published commit.
  const ref = `refs/heads/snapshots/${current.snapshotId}`;
  const existing = await git(["ls-remote", "origin", ref]);
  const localCandidate = await git(["rev-parse", "--verify", ref]).catch(
    () => null,
  );
  let commit: string;
  if (existing) {
    commit = existing.split(/\s/)[0];
  } else if (localCandidate) {
    if (await hasManagedChanges(git))
      throw new Error(
        "Preserve pending changes in the publication checkout before retrying.",
      );
    await git(["checkout", ref]);
    commit = localCandidate;
    await timed("upload LFS objects", () =>
      git(["lfs", "push", "origin", ref]),
    );
    await timed("push data Git ref", () =>
      git(["push", "origin", `${ref}:${ref}`]),
    );
  } else {
    if (await hasManagedChanges(git))
      throw new Error(
        `Publication checkout has pending changes: ${root}. Inspect and preserve before retrying.`,
      );
    if (previous) {
      await git(["fetch", "--no-tags", "origin", previous.commit]);
      await git(["checkout", "--detach", previous.commit]);
    }
    // Copy only the verified bundle, preserving all earlier content-addressed files.
    const paths = [
      `snapshots/${current.snapshotId}/manifest.json`,
      ...current.manifest.tables.flatMap((table) =>
        table.chunks.map((c) => `tables/${c.sha256}.ndjson`),
      ),
      ...current.manifest.objects.map((o) => `objects/${o.sha256}`),
    ];
    await writePublicationMetadata(root);
    const objectsByPath = new Map(
      current.manifest.objects.map((file) => [`objects/${file.sha256}`, file]),
    );
    const chunksByPath = new Map(
      current.manifest.tables
        .flatMap((table) => table.chunks)
        .map((file) => [`tables/${file.sha256}.ndjson`, file]),
    );
    const { writeFile } = await import("node:fs/promises");
    for (const path of new Set(paths)) {
      const target = resolve(root, path);
      if (existsSync(target)) {
        const existing = await readFile(target);
        const object = objectsByPath.get(path);
        if (
          object &&
          (sha256(existing) === object.sha256 ||
            existing.toString("utf8") ===
              `version https://git-lfs.github.com/spec/v1\noid sha256:${object.sha256}\nsize ${object.bytes}\n`)
        )
          continue;
        const chunk = chunksByPath.get(path);
        if (chunk && sha256(existing) === chunk.sha256) continue;
      }
      await mkdir(resolve(target, ".."), { recursive: true });
      await writeFile(target, await readFile(resolve(current.root, path)));
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
    await timed("upload LFS objects", () =>
      git(["lfs", "push", "origin", ref]),
    );
    await timed("push data Git ref", () =>
      git(["push", "origin", `${ref}:${ref}`]),
    );
  }
  // This separate LFS store contains only remotely fetched bytes. A normal update reuses
  // earlier verified remote content; an explicit audit starts with an empty store.
  const verificationRoot = options.fullVerification
    ? resolve(syncRoot(), "remote-verification", randomUUID())
    : resolve(syncRoot(), "verified-remote");
  await mkdir(verificationRoot, { recursive: true });
  if (!existsSync(resolve(verificationRoot, ".git/HEAD"))) {
    await codeGit(["init", verificationRoot]);
    await dataGit(["remote", "add", "origin", remote], verificationRoot, true);
  }
  if (
    (await dataGit(["remote", "get-url", "origin"], verificationRoot, true)) !==
    remote
  )
    throw new Error("Remote verification checkout has another remote.");
  await dataGit(
    ["fetch", "--no-tags", "--depth=1", "origin", commit],
    verificationRoot,
    true,
  );
  await dataGit(["checkout", "--detach", commit], verificationRoot, true);
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
  const verification = await timed("verify remote content", () =>
    fetchSnapshot(lock, { root: verificationRoot, isolatedLfs: true }),
  );
  await confirmCurrentData(current.manifest);
  await atomicJson(resolve("dev-data.lock.json"), lock);
  await atomicJson(resolve(syncRoot(), "last-publication.json"), {
    lock,
    verificationRoot,
    verifiedAt: new Date().toISOString(),
    mode: options.fullVerification ? "full" : "incremental",
    transfer: verification.transfer,
  });
  return { lock, changed: true };
}
