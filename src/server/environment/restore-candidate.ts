import { resolve } from "node:path";
import { z } from "zod";
import type { DatabaseIdentity } from "@/domain/environment";
import { getMedota2StateDirectory } from "@/config/medota2-state";
import {
  leaseSchema,
  readActiveSnapshot,
  readSyncJson,
  syncRoot,
  validateCandidateLease,
} from "@/config/data-sync-state";

export const restoreCandidateSchema = z
  .object({
    version: z.literal(1),
    candidateId: z.uuid(),
    lease: leaseSchema,
    instanceId: z.uuid(),
    databaseId: z.uuid(),
    phase: z.enum(["ready-to-restore", "restored", "verified"]),
  })
  .strict();

/** An ordinary/active database can never obtain the restore capability. */
export function assertRestoreCandidate(identity: DatabaseIdentity): void {
  const state = getMedota2StateDirectory();
  const id = state.split(/[\\/]/).at(-2) ?? "";
  if (
    !z.uuid().safeParse(id).success ||
    state !== resolve(syncRoot(), "candidates", id, "state")
  )
    throw new Error(
      "Restore requires a newly provisioned candidate state root.",
    );
  const receipt = restoreCandidateSchema.parse(
    readSyncJson(resolve(state, "../candidate.json")),
  );
  validateCandidateLease(id, receipt.lease);
  if (
    receipt.candidateId !== id ||
    receipt.phase !== "ready-to-restore" ||
    receipt.instanceId !== identity.instanceId ||
    receipt.databaseId !== identity.databaseId ||
    receipt.lease.environment !== identity.environment ||
    receipt.lease.hostPort !== identity.endpointPort ||
    readActiveSnapshot()?.candidateId === id
  )
    throw new Error(
      "Restore candidate identity, endpoint or lifecycle does not match.",
    );
}
