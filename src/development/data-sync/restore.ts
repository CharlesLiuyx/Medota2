import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { provisionDataStack } from "@/server/environment/data-stack-lifecycle";
import { openVerifiedDatabase } from "@/server/environment/contract";
import { runMigrations } from "@/server/db/run-migrations";
import { restoreCandidateSchema } from "@/server/environment/restore-candidate";
import {
  syncRoot,
  leaseSchema,
  activeSchema,
  readActiveSnapshot,
  readSyncWorkspace,
  readSyncJson,
  type ActiveSnapshot,
} from "@/config/data-sync-state";
import { getMedota2StateDirectory } from "@/config/medota2-state";
import {
  getPreviewDataSource,
  previewEnvironment,
} from "@/development/preview";
import { readJson, run, processAlive } from "@/development/runtime";
import { collectDatabase, restoreDatabase } from "./database";
import { readSnapshot, verifySnapshotFiles } from "./snapshot";
import { prepareDependencies } from "./dependencies";
import {
  digest,
  hasUnexportedChanges,
  type SnapshotManifest,
} from "./protocol";
import { atomicJson } from "./files";
import { taskProcess, type inspectDatabase } from "./tasks";
import { mapDigest } from "./maps";

type Inspection = Awaited<ReturnType<typeof inspectDatabase>>;
export async function restoreCandidateTask(
  root: string,
  id: string,
): Promise<Inspection> {
  const saved = await readSnapshot(root, id);
  await verifySnapshotFiles(root, saved.manifest);
  const environment = saved.manifest.environment;
  if (process.env.MEDOTA2_ENVIRONMENT !== environment)
    throw new Error("Candidate environment differs from snapshot.");
  const confirmation =
    environment === "local-review" ? "medota2_local" : "medota2";
  const migrator = await openVerifiedDatabase({
    role: "migration",
    operation: "migrate",
    confirmation,
  });
  try {
    await runMigrations(migrator);
  } finally {
    await migrator.end();
  }
  const state = getMedota2StateDirectory();
  const record = restoreCandidateSchema.parse(
    readSyncJson(resolve(state, "../candidate.json")),
  );
  const db = await openVerifiedDatabase({
    role: "migration",
    operation: "restore",
    confirmation,
  });
  try {
    await restoreDatabase(db, saved.manifest, root);
  } finally {
    await db.end();
  }
  await atomicJson(resolve(state, "../candidate.json"), {
    ...record,
    phase: "restored",
  });
  const web = await openVerifiedDatabase({ role: "web", operation: "read" });
  try {
    const content = await web.readSnapshot((reader) => collectDatabase(reader));
    if (digest(content.tables) !== saved.manifest.databaseDigest)
      throw new Error("Restored database content does not match snapshot.");
    await atomicJson(resolve(state, "../candidate.json"), {
      ...record,
      phase: "verified",
    });
    return {
      databaseDigest: digest(content.tables),
      mapDigest: mapDigest(saved.manifest.map),
      tables: content.tables.map(({ name, rows }) => ({ name, rows })),
      heads: content.heads,
      identity: {
        instanceId: web.identity.instanceId,
        databaseId: web.identity.databaseId,
        environment: web.identity.environment,
      },
      checkedAt: new Date().toISOString(),
    };
  } finally {
    await web.end();
  }
}

export async function inspectCurrent(): Promise<Inspection | null> {
  const environment = previewEnvironment(getPreviewDataSource());
  const state =
    readActiveSnapshot()?.lease.stateDirectory ??
    resolve(environment.MEDOTA2_STATE_DIRECTORY!);
  if (!existsSync(resolve(state, "environment-identities.v1.json")))
    return null;
  return taskProcess<Inspection>("inspect", [], environment);
}
export async function applicationPlan(manifest: SnapshotManifest) {
  const actual = await inspectCurrent();
  const active = readActiveSnapshot();
  const exported = await readJson<{
    manifest: SnapshotManifest;
    identity: { databaseId: string };
  }>(resolve(syncRoot(), "last-export.json"));
  const savedDigest =
    active?.databaseDigest ??
    (exported?.identity.databaseId === actual?.identity.databaseId
      ? exported?.manifest.databaseDigest
      : null);
  const nonempty = Boolean(actual?.tables.some((table) => table.rows > 0));
  const databaseUnsaved = hasUnexportedChanges({
    current: actual?.databaseDigest ?? null,
    target: manifest.databaseDigest,
    baseline: savedDigest ?? null,
    nonempty,
    exported:
      exported?.identity.databaseId === actual?.identity.databaseId
        ? (exported?.manifest.databaseDigest ?? null)
        : null,
  });
  const baselineManifest = active
    ? (readSyncJson(
        resolve(active.lease.stateDirectory, "../manifest.json"),
      ) as SnapshotManifest)
    : null;
  const mapsUnsaved = Boolean(
    actual &&
    hasUnexportedChanges({
      current: actual.mapDigest,
      target: mapDigest(manifest.map),
      baseline: baselineManifest ? mapDigest(baselineManifest.map) : null,
      exported: exported ? mapDigest(exported.manifest.map) : null,
      nonempty: actual.mapDigest !== mapDigest(null),
    }),
  );
  return {
    targetDigest: manifest.databaseDigest,
    current: actual,
    unsaved: databaseUnsaved || mapsUnsaved,
    mapsUnsaved,
    targetMapDigest: mapDigest(manifest.map),
    changes: manifest.tables.map((table) => ({
      name: table.name,
      before:
        actual?.tables.find((item) => item.name === table.name)?.rows ?? 0,
      after: table.rows,
    })),
    activeSnapshot: active?.snapshotId ?? null,
  };
}

export async function prepareCandidate(
  root: string,
  id: string,
  options: { offline?: boolean } = {},
) {
  const saved = await readSnapshot(root, id);
  await verifySnapshotFiles(root, saved.manifest);
  const plan = await applicationPlan(saved.manifest);
  if (plan.unsaved)
    throw new Error(
      "Current database or maps have unexported changes. Run pnpm data:export to preserve them before applying another snapshot.",
    );
  const dependencies = await prepareDependencies(
    saved.manifest,
    root,
    options.offline,
  );
  const workspace = readSyncWorkspace();
  if (!workspace) throw new Error("Initialize the workspace first.");
  const candidateId = randomUUID();
  const lease = leaseSchema.parse(
    await provisionDataStack({
      environment: saved.manifest.environment,
      candidateId,
      onProgress: console.log,
    }),
  );
  const receipt = JSON.parse(
    await readFile(
      resolve(lease.stateDirectory, "environment-identities.v1.json"),
      "utf8",
    ),
  );
  const record = restoreCandidateSchema.parse({
    version: 1,
    candidateId,
    lease,
    instanceId: receipt.instanceId,
    databaseId: receipt.databases[saved.manifest.environment].databaseId,
    phase: "ready-to-restore",
  });
  await atomicJson(resolve(lease.stateDirectory, "../candidate.json"), record);
  await atomicJson(
    resolve(lease.stateDirectory, "../manifest.json"),
    saved.manifest,
  );
  const verification = await taskProcess<Inspection>(
    "restore",
    ["--root", root, "--snapshot", id],
    {
      ...process.env,
      MEDOTA2_STATE_DIRECTORY: lease.stateDirectory,
      MEDOTA2_ENVIRONMENT: saved.manifest.environment,
      MEDOTA2_DATA_CLASS:
        saved.manifest.environment === "local-review"
          ? "production-snapshot"
          : "sandbox",
      MEDOTA2_DATABASE_CONFIRMATION:
        saved.manifest.environment === "local-review"
          ? "medota2_local"
          : "medota2",
    },
  );
  const active = activeSchema.parse({
    version: 1,
    workspaceId: workspace.id,
    candidateId,
    snapshotId: id,
    manifestSha256: saved.manifestSha256,
    databaseDigest: saved.manifest.databaseDigest,
    appliedAt: new Date().toISOString(),
    lease,
    ...dependencies,
    mapInputsAtApply: {
      collectionPath: process.env.DOTA_MAP_COLLECTION_PATH ?? "",
      dataPath: process.env.DOTA_MAP_DATA_PATH ?? "",
    },
  });
  await atomicJson(resolve(lease.stateDirectory, "../activation.json"), active);
  return { active, verification, plan };
}

interface SwitchJournal {
  version: 1;
  phase: "switching" | "completed" | "rolled-back";
  previous: ActiveSnapshot | null;
  next: ActiveSnapshot;
  wasRunning: boolean;
}
const journalPath = () => resolve(syncRoot(), "switch.json");
async function workbenchRunning() {
  const owner = await readJson<{ pid: number; workspace: string }>(
    resolve(".medota2/development/owner.json"),
  );
  return Boolean(
    owner && owner.workspace === process.cwd() && processAlive(owner.pid),
  );
}
export async function recoverInterruptedSwitch(): Promise<void> {
  const journal = await readJson<SwitchJournal>(journalPath());
  if (!journal || journal.phase !== "switching") return;
  const current = readActiveSnapshot();
  if (
    current?.candidateId !== journal.next.candidateId &&
    current?.candidateId !== journal.previous?.candidateId &&
    !(current === null && journal.previous === null)
  )
    throw new Error(
      "Interrupted switch does not match current state; inspect its journal before continuing.",
    );
  activeSchema.parse(journal.next);
  if (journal.previous) activeSchema.parse(journal.previous);
  await run(process.execPath, [
    "--import",
    "tsx",
    "src/workers/dev.ts",
    "--stop",
  ]);
  await atomicJson(resolve(syncRoot(), "active.json"), journal.previous);
  await atomicJson(journalPath(), { ...journal, phase: "rolled-back" });
  if (journal.wasRunning)
    await run(process.execPath, ["--import", "tsx", "src/workers/dev.ts"]);
  await atomicJson(journalPath(), { ...journal, phase: "rolled-back" });
}
export async function activateCandidate(
  next: ActiveSnapshot,
  expectedDigest: string | null,
  expectedMapDigest: string | null,
): Promise<void> {
  const current = await inspectCurrent();
  if ((current?.databaseDigest ?? null) !== expectedDigest)
    throw new Error(
      "Current database changed while preparing the candidate. Export those changes and retry activation.",
    );
  if ((current?.mapDigest ?? null) !== expectedMapDigest)
    throw new Error(
      "Current maps changed while preparing the candidate. Export and retry.",
    );
  const previous = readActiveSnapshot();
  const journal: SwitchJournal = {
    version: 1,
    phase: "switching",
    previous,
    next,
    wasRunning: await workbenchRunning(),
  };
  await atomicJson(journalPath(), journal);
  try {
    await run(process.execPath, [
      "--import",
      "tsx",
      "src/workers/dev.ts",
      "--stop",
    ]);
    // The switch journal blocks existing/new writer handles, including COMMIT.
    // Recheck after stopping the UI before selecting the candidate.
    const stopped = await inspectCurrent();
    if ((stopped?.databaseDigest ?? null) !== expectedDigest)
      throw new Error("Source data changed before cutover.");
    if ((stopped?.mapDigest ?? null) !== expectedMapDigest)
      throw new Error("Maps changed before cutover.");
    await atomicJson(resolve(syncRoot(), "active.json"), next);
    await run(process.execPath, ["--import", "tsx", "src/workers/dev.ts"]);
    await atomicJson(journalPath(), { ...journal, phase: "completed" });
  } catch (error) {
    await recoverInterruptedSwitch();
    throw error;
  }
}
