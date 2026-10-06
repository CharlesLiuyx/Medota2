import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { loadLocalEnv } from "@/config/env";
import { adaptUnits, unitTokens, UNIT_ADAPTER_VERSION } from "./unit-adapter";
export interface UnitSnapshotMeta {
  datasetVersionId: string;
  sourceCommit: string;
  sourceRepository: string;
  clientVersion: string;
}
const exec = promisify(execFile);
const cache = new Map<
  string,
  ReturnType<typeof adaptUnits> & { provenance: object }
>();
const paths = [
  "scripts/npc/npc_units.txt",
  "resource/localization/abilities_schinese.txt",
  "resource/localization/abilities_english.txt",
];
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export async function readPinnedUnitSnapshot(
  meta: UnitSnapshotMeta,
  record: { source_commit: string; raw_sha256: string } | undefined,
) {
  loadLocalEnv();
  if (!/^[a-f0-9]{40}$/.test(meta.sourceCommit)) return null;
  if (!record || record.source_commit !== meta.sourceCommit) return null;
  const key = `${meta.datasetVersionId}:${meta.sourceCommit}:${record.raw_sha256}`;
  if (cache.has(key)) return cache.get(key)!;
  const roots = [
    resolve(
      process.env.DOTA_VPK_WORKTREE_ROOT || ".medota2/cache/worktrees",
      meta.sourceCommit,
    ),
    process.env.DOTA_VPK_UPDATES_PATH,
  ].filter((v): v is string => Boolean(v));
  for (const root of roots) {
    let files: string[];
    try {
      const read = async (path: string) =>
        (
          await exec(
            "git",
            ["-C", root, "show", `${meta.sourceCommit}:${path}`],
            { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 5000 },
          )
        ).stdout;
      if (sha(await read("steam.inf")) !== record.raw_sha256) continue;
      files = await Promise.all(paths.map(read));
    } catch {
      continue;
    }
    // Validation failures propagate: never silently accept a malformed snapshot.
    const adapted = adaptUnits(
      files[0],
      unitTokens(files[1]),
      unitTokens(files[2]),
    );
    const snapshot = {
      ...adapted,
      provenance: {
        source_repository: meta.sourceRepository,
        source_commit: meta.sourceCommit,
        source_path: paths[0],
        client_version: meta.clientVersion,
        imported_at: new Date().toISOString(),
        importer_version: UNIT_ADAPTER_VERSION,
        schema_version: "unit-read-model-v1",
        files: paths.map((path, i) => ({
          source_path: path,
          raw_sha256: sha(files[i]),
        })),
      },
    };
    if (cache.size >= 2) cache.delete(cache.keys().next().value!);
    cache.set(key, snapshot);
    return snapshot;
  }
  return null;
}
