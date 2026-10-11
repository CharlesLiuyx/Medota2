import "server-only";
import { cache } from "react";
import { getWebDatabase } from "@/server/db/client";
interface SourceFileRecord {
  source_commit: string;
  raw_sha256: string;
}
/** Recheck the catalog's recorded hash before content-cache lookup; deduplicate only within a request. */
export const sourceFileRecord = cache(async (dataset: string, path: string) => {
  const db = await getWebDatabase();
  const result = await db.query<SourceFileRecord>(
    "SELECT s.source_commit, f.raw_sha256 FROM source_snapshot_files f JOIN source_snapshots s ON s.id=f.source_snapshot_id JOIN hero_catalog_dataset_versions v ON v.source_snapshot_id=s.id WHERE v.id=$1 AND f.source_path=$2",
    [dataset, path],
  );
  return result.rows[0] ?? null;
});
