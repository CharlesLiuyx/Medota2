import { resolve } from "node:path";
import { readActiveSnapshot, readSyncJson } from "@/config/data-sync-state";
import { manifestSchema } from "./protocol";
import { schemaDigest } from "./schema";
import { migrationDigest } from "./database";

export async function assertActiveSnapshotCompatible(): Promise<void> {
  const active = readActiveSnapshot();
  if (!active) return;
  const manifest = manifestSchema.parse(
    readSyncJson(resolve(active.lease.stateDirectory, "../manifest.json")),
  );
  if (
    manifest.schemaDigest !== schemaDigest ||
    manifest.migrationsDigest !== (await migrationDigest())
  )
    throw new Error(
      "Active snapshot is incompatible with this code. Run pnpm dev:sync with the matching code lock before starting.",
    );
}
