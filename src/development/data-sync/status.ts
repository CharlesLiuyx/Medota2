import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import {
  readSyncWorkspace,
  readActiveSnapshot,
  syncRoot,
} from "@/config/data-sync-state";
import { readJson } from "@/development/runtime";
import { readDataLock, repositoryRoot } from "./git";
import { readSnapshot } from "./snapshot";
import { inspectCurrent } from "./restore";
import { taskProcess } from "./tasks";
import { atomicJson } from "./files";
import { type SnapshotManifest } from "./protocol";
import { mapDigest } from "./maps";
const exec = promisify(execFile);
export async function syncStatus() {
  const workspace = readSyncWorkspace();
  const lock = await readDataLock();
  const active = readActiveSnapshot();
  const current = await inspectCurrent();
  const codeCommit = (await exec("git", ["rev-parse", "HEAD"])).stdout.trim();
  const codeDirty = Boolean(
    (await exec("git", ["status", "--porcelain"])).stdout.trim(),
  );
  let manifest: SnapshotManifest | undefined;
  let root: string | undefined;
  const problems: string[] = [];
  if (lock) {
    for (const candidate of [repositoryRoot(), resolve(syncRoot(), "export")]) {
      try {
        manifest = (
          await readSnapshot(candidate, lock.snapshotId, lock.manifestSha256)
        ).manifest;
        root = candidate;
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    if (!manifest) problems.push("Target snapshot has not been fetched.");
  } else {
    const saved = await readJson<{ manifest: SnapshotManifest; root: string }>(
      resolve(syncRoot(), "last-export.json"),
    );
    manifest = saved?.manifest;
    root = saved?.root;
  }
  if (manifest && root)
    problems.push(
      ...(await taskProcess<string[]>("dependencies", [
        "--root",
        root,
        "--snapshot",
        lock?.snapshotId ?? (await import("./protocol")).snapshotId(manifest),
      ])),
    );
  const state = !current
    ? "unprepared"
    : !lock
      ? "unlocked"
      : !manifest
        ? "not-fetched"
        : current.databaseDigest !== manifest.databaseDigest ||
            current.mapDigest !== mapDigest(manifest.map)
          ? "data-differs"
          : problems.length
            ? "dependencies-missing"
            : codeDirty
              ? "code-modified"
              : "in-sync";
  const report = {
    version: 1,
    workspace,
    codeCommit,
    codeDirty,
    target: lock,
    activeSnapshot: active?.snapshotId ?? null,
    current,
    state,
    problems,
    checkedAt: new Date().toISOString(),
  };
  await atomicJson(resolve(syncRoot(), "verification.json"), report);
  return report;
}
