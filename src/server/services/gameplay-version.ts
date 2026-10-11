import "server-only";
import { readPinnedGameplayVersion } from "@/importers/dota-vpk/gameplay-version";
import { sourceFileRecord } from "./source-file-records";
export { parseGameplayVersion } from "@/importers/dota-vpk/gameplay-version";

/** Read immutable Git objects, bound to the catalog's recorded steam.inf hash. */
export async function getGameplayVersion(
  dataset: string,
  commit: string,
): Promise<string | null> {
  if (!/^[a-f0-9]{40}$/u.test(commit)) return null;
  const record = await sourceFileRecord(dataset, "steam.inf");
  if (!record || record.source_commit !== commit) return null;
  return readPinnedGameplayVersion(commit, record.raw_sha256);
}
