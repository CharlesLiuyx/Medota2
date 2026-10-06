import { resolve, sep } from "node:path";
import {
  readActiveSnapshot,
  readSyncJson,
  syncRoot,
} from "@/config/data-sync-state";
import type {
  DatabaseOperation,
  RuntimeEnvironment,
} from "@/domain/environment";

/** Existing writer handles must not commit into a database after cutover. */
export function assertSnapshotWritable(
  state: string,
  environment: RuntimeEnvironment,
  operation: DatabaseOperation,
): void {
  if (
    operation === "read" ||
    !["development", "local-review"].includes(environment)
  )
    return;
  const active = readActiveSnapshot();
  const candidate = state.startsWith(resolve(syncRoot(), "candidates") + sep)
    ? (readSyncJson(resolve(state, "../candidate.json")) as {
        phase?: string;
      } | null)
    : null;
  // The only independent writers are newly provisioned, not-yet-active candidates.
  if (
    ["migrate", "restore"].includes(operation) &&
    candidate?.phase === "ready-to-restore"
  )
    return;
  if (
    active?.lease.environment === environment &&
    active.lease.stateDirectory !== state
  )
    throw new Error(
      "Database selection changed; reopen the writer against the active snapshot.",
    );
  const journal = readSyncJson(resolve(syncRoot(), "switch.json")) as {
    phase?: string;
    next?: { lease?: { stateDirectory?: string; environment?: string } };
  } | null;
  if (
    journal?.phase === "switching" &&
    journal.next?.lease?.environment === environment &&
    journal.next.lease.stateDirectory !== state
  )
    throw new Error(
      "Snapshot cutover is in progress; retry the write after it finishes.",
    );
}
