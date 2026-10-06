import { bundleSnapshot } from "@/development/data-sync/bundle";
import {
  readDataLock,
  fetchSnapshot,
  lockPublishedSnapshot,
} from "@/development/data-sync/git";
import { syncStatus } from "@/development/data-sync/status";
import {
  applicationPlan,
  prepareCandidate,
  activateCandidate,
  recoverInterruptedSwitch,
  restoreCandidateTask,
} from "@/development/data-sync/restore";
import {
  readSnapshot,
  verifySnapshotFiles,
} from "@/development/data-sync/snapshot";
import { verifyLiveDependencies } from "@/development/data-sync/dependencies";
import {
  readActiveSnapshot,
  readSyncWorkspace,
} from "@/config/data-sync-state";
import { run } from "@/development/runtime";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/config/env";
import { syncRoot } from "@/config/data-sync-state";
import { ensureWorkspace } from "@/development/data-sync/workspace";
import {
  taskProcess,
  exportDatabase,
  inspectDatabase,
} from "@/development/data-sync/tasks";
import { acquireLock } from "@/development/runtime";
import { publishData } from "@/development/data-sync/publish";
import { mapDigest } from "@/development/data-sync/maps";

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      task: { type: "string" },
      root: { type: "string" },
      name: { type: "string" },
      profile: { type: "string" },
      port: { type: "string" },
      repository: { type: "string" },
      snapshot: { type: "string" },
      commit: { type: "string" },
      plan: { type: "boolean" },
      offline: { type: "boolean" },
      "prepare-only": { type: "boolean" },
      "backup-local": { type: "boolean" },
    },
  });
  loadLocalEnv();
  if (values.task) {
    if (values.task === "inspect") return output(await inspectDatabase());
    if (values.task === "export")
      return output(
        await exportDatabase(
          resolve(values.root || resolve(syncRoot(), "export")),
        ),
      );
    if (values.task === "restore" && values.root && values.snapshot)
      return output(await restoreCandidateTask(values.root, values.snapshot));
    if (values.task === "dependencies" && values.root && values.snapshot)
      return output(
        await verifyLiveDependencies(
          (await readSnapshot(values.root, values.snapshot)).manifest,
        ),
      );
    throw new Error("Unknown internal data task.");
  }
  const command = positionals[0] || "status";
  const workspace = values.plan
    ? readSyncWorkspace()
    : await ensureWorkspace({
        name: values.name,
        profile: values.profile,
        port: values.port ? Number(values.port) : undefined,
      });
  if (command === "init") return output(workspace);
  const release = values.plan ? async () => {} : await acquireLock("data-sync");
  try {
    if (command === "publish") return output(await publishData());
    if (command === "export") {
      const result = await taskProcess<
        Awaited<ReturnType<typeof exportDatabase>>
      >("export", ["--root", resolve(syncRoot(), "export")]);
      return output({
        snapshotId: result.snapshotId,
        manifestSha256: result.manifestSha256,
        root: result.root,
        tables: result.manifest.tables.length,
        objects: result.manifest.objects.length,
        ...(await verifySnapshotFiles(result.root, result.manifest)),
      });
    }
    if (command === "bundle") {
      if (!values.snapshot)
        throw new Error(
          "Pass --snapshot to prepare the exact publication payload.",
        );
      return output(
        await bundleSnapshot(
          resolve(values.root || resolve(syncRoot(), "export")),
          values.snapshot,
        ),
      );
    }
    if (command === "status") {
      const status = await syncStatus();
      output(status);
      if (status.state !== "in-sync") process.exitCode = 2;
      return;
    }
    if (command === "lock") {
      if (!values.commit || !values.snapshot)
        throw new Error(
          "Pass --commit and --snapshot for the published data candidate.",
        );
      return output(
        await lockPublishedSnapshot(
          values.commit,
          values.snapshot,
          values.repository,
        ),
      );
    }
    if (["fetch", "apply", "sync"].includes(command)) {
      if (!values.plan) await recoverInterruptedSwitch();
      let root = values.root ? resolve(values.root) : undefined;
      let id = values.snapshot;
      const lock = await readDataLock();
      if (!root) {
        if (!lock)
          throw new Error(
            "No dev-data.lock.json. Publish/lock a snapshot first, or use --root and --snapshot for a local candidate.",
          );
        const fetched = await fetchSnapshot(lock, {
          repository: values.repository,
          offline: values.offline || values.plan,
        });
        root = fetched.root;
        id = lock.snapshotId;
      }
      if (!id) throw new Error("Pass --snapshot with --root.");
      const saved = await readSnapshot(
        root,
        id,
        lock?.snapshotId === id ? lock.manifestSha256 : undefined,
      );
      const files = await verifySnapshotFiles(root, saved.manifest);
      if (command === "fetch") return output({ snapshotId: id, ...files });
      const plan = await applicationPlan(saved.manifest);
      if (values.plan) return output({ snapshotId: id, ...plan, ...files });
      if (plan.unsaved && (values["backup-local"] || command === "sync")) {
        const backup = await taskProcess<
          Awaited<ReturnType<typeof exportDatabase>>
        >("export", ["--root", resolve(syncRoot(), "export")]);
        console.log(
          `Saved local data before applying the shared snapshot: ${backup.snapshotId}`,
        );
      }
      if (command === "sync")
        await run("pnpm", ["install", "--frozen-lockfile"]);
      const active = readActiveSnapshot();
      if (
        active?.snapshotId === id &&
        plan.current?.databaseDigest === saved.manifest.databaseDigest &&
        plan.current?.mapDigest === mapDigest(saved.manifest.map)
      ) {
        const problems = await taskProcess<string[]>("dependencies", [
          "--root",
          root,
          "--snapshot",
          id,
        ]);
        if (problems.length) throw new Error(problems.join("\n"));
        if (command === "sync")
          await run(process.execPath, [
            "--import",
            "tsx",
            "src/workers/dev.ts",
            "--restart",
          ]);
        return output({
          snapshotId: id,
          state: "already-applied",
          origin: `http://127.0.0.1:${workspace?.webPort ?? 3000}`,
        });
      }
      const prepared = await prepareCandidate(root, id, {
        offline: values.offline,
      });
      if (values["prepare-only"]) return output(prepared);
      await activateCandidate(
        prepared.active,
        prepared.plan.current?.databaseDigest ?? null,
        prepared.plan.current?.mapDigest ?? null,
      );
      return output({
        state: "applied",
        snapshotId: id,
        verification: prepared.verification,
        origin: `http://127.0.0.1:${workspace?.webPort ?? 3000}`,
      });
    }
    throw new Error(`Unknown data command: ${command}`);
  } finally {
    await release();
  }
}
function output(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Data sync failed.");
  process.exitCode = 1;
});
