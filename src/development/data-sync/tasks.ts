import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { openVerifiedDatabase } from "@/server/environment/contract";
import { readActiveSnapshot, syncRoot } from "@/config/data-sync-state";
import {
  previewEnvironment,
  getPreviewDataSource,
} from "@/development/preview";
import { collectDatabase } from "./database";
import { exportSnapshot } from "./snapshot";
import { digest } from "./protocol";
import { atomicJson } from "./files";
import { inspectMaps, mapDigest } from "./maps";
import { readFile } from "node:fs/promises";
import { listMigrations } from "@/server/db/migrations";
import { reviewedInspectionContract } from "./inspection-schema";
import { manifestSchema, snapshotId } from "./protocol";
const execute = promisify(execFile);
export async function taskProcess<T>(
  task: string,
  args: string[] = [],
  environment: NodeJS.ProcessEnv = previewEnvironment(getPreviewDataSource()),
): Promise<T> {
  const result = await execute(
    process.execPath,
    [
      // This Windows runtime exhibited native crashes and inconsistent bytea decoding.
      // Server-side hashes and interpreter-only reads agree; keep the workaround in the adapter.
      ...(process.platform === "win32" && process.versions.node === "24.19.0"
        ? ["--jitless"]
        : []),
      "--import",
      "tsx",
      "src/workers/data-sync.ts",
      "--task",
      task,
      ...args,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...environment,
        MEDOTA2_PROCESS_ROLE: "control",
        MEDOTA2_WORKBENCH: "0",
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 300_000,
    },
  );
  return JSON.parse(result.stdout) as T;
}
export async function inspectDatabase() {
  const db = await openVerifiedDatabase({ role: "web", operation: "read" });
  try {
    const active = readActiveSnapshot();
    let contract: ReturnType<typeof reviewedInspectionContract>;
    if (active) {
      const bytes = await readFile(
        active.snapshotManifestPath ??
          resolve(active.lease.stateDirectory, "../manifest.json"),
      );
      const manifest = manifestSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (
        snapshotId(manifest) !== active.snapshotId ||
        manifest.databaseDigest !== active.databaseDigest
      )
        throw new Error("Active snapshot manifest identity mismatch.");
      contract = reviewedInspectionContract(
        manifest,
        (await listMigrations()).map(({ id, sha256 }) => ({ id, sha256 })),
      );
    }
    const content = await db.readSnapshot((reader) =>
      collectDatabase(reader, undefined, contract),
    );
    return {
      databaseDigest: digest(content.tables),
      mapDigest: mapDigest(await inspectMaps()),
      tables: content.tables.map(({ name, rows }) => ({ name, rows })),
      heads: content.heads,
      identity: {
        instanceId: db.identity.instanceId,
        databaseId: db.identity.databaseId,
        environment: db.identity.environment,
      },
      checkedAt: new Date().toISOString(),
    };
  } finally {
    await db.end();
  }
}
export async function exportDatabase(root: string) {
  const db = await openVerifiedDatabase({ role: "web", operation: "read" });
  try {
    const active = readActiveSnapshot();
    const result = await exportSnapshot(
      db,
      root,
      active ? [active.snapshotId] : [],
    );
    await atomicJson(resolve(syncRoot(), "last-export.json"), {
      ...result,
      identity: {
        databaseId: db.identity.databaseId,
        instanceId: db.identity.instanceId,
      },
    });
    return result;
  } finally {
    await db.end();
  }
}
