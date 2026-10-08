import { pinnedVpkRoots } from "./source-roots";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { loadLocalEnv } from "@/config/env";
import { adaptItems, ITEM_ADAPTER_VERSION } from "./item-adapter";
import { unitTokens } from "./unit-adapter";
import { itemParameterProvenance } from "@/domain/item-parameter-labels";
import {
  nameSupplementProvenance,
  supplementEntityNames,
} from "@/domain/entity-names";
export interface ItemSnapshotMeta {
  datasetVersionId: string;
  sourceCommit: string;
  sourceRepository: string;
  clientVersion: string;
}
const exec = promisify(execFile);
const cache = new Map<
  string,
  ReturnType<typeof adaptItems> & { provenance: object }
>();
const paths = [
  "scripts/npc/items.txt",
  "resource/localization/abilities_schinese.txt",
  "resource/localization/abilities_english.txt",
];
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export async function readPinnedItemSnapshot(
  meta: ItemSnapshotMeta,
  record: { source_commit: string; raw_sha256: string } | undefined,
) {
  loadLocalEnv();
  if (!/^[a-f0-9]{40}$/.test(meta.sourceCommit)) return null;
  if (!record || record.source_commit !== meta.sourceCommit) return null;
  const key = `${meta.datasetVersionId}:${meta.sourceCommit}:${record.raw_sha256}`;
  if (cache.has(key)) return cache.get(key)!;
  const roots = pinnedVpkRoots(meta.sourceCommit);
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
    const adapted = adaptItems(
      files[0],
      supplementEntityNames(unitTokens(files[1]), meta.sourceCommit, "zh-CN"),
      supplementEntityNames(unitTokens(files[2]), meta.sourceCommit, "en"),
      meta.sourceCommit,
    );
    const snapshot = {
      ...adapted,
      provenance: {
        source_repository: meta.sourceRepository,
        source_commit: meta.sourceCommit,
        source_path: paths[0],
        client_version: meta.clientVersion,
        imported_at: new Date().toISOString(),
        importer_version: ITEM_ADAPTER_VERSION,
        schema_version: "item-read-model-v2",
        name_supplement: nameSupplementProvenance(meta.sourceCommit),
        parameter_labels: itemParameterProvenance(meta.sourceCommit),
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
