import "server-only";
import { readPinnedGameplayVersion } from "@/importers/dota-vpk/gameplay-version";
import { getWebDatabase } from "@/server/db/client";
export { parseGameplayVersion } from "@/importers/dota-vpk/gameplay-version";

/** Read immutable Git objects, bound to the catalog's recorded steam.inf hash. */
export async function getGameplayVersion(
  dataset: string,
  commit: string,
): Promise<string | null> {
  if (!/^[a-f0-9]{40}$/u.test(commit)) return null;
  const db = await getWebDatabase();
  const result = await db.query<{ raw_sha256: string; source_commit: string }>(
    `SELECT f.raw_sha256, s.source_commit FROM source_snapshot_files f JOIN source_snapshots s ON s.id = f.source_snapshot_id JOIN hero_catalog_dataset_versions v ON v.source_snapshot_id = f.source_snapshot_id WHERE v.id = $1 AND f.source_path = 'steam.inf'`,
    [dataset],
  );
  const record = result.rows[0];
  if (!record || record.source_commit !== commit) return null;
  return readPinnedGameplayVersion(commit, record.raw_sha256);
}
