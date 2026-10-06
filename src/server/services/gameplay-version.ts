import "server-only";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { loadLocalEnv } from "@/config/env";
import { parseKeyValues } from "@/importers/keyvalues/parser";
import { getWebDatabase } from "@/server/db/client";

const exec = promisify(execFile);
const versions = new Map<string, string>();

/** Read immutable Git objects, bound to the catalog's recorded steam.inf hash. */
export async function getGameplayVersion(
  dataset: string,
  commit: string,
): Promise<string | null> {
  if (!/^[a-f0-9]{40}$/u.test(commit)) return null;
  loadLocalEnv();
  const db = await getWebDatabase();
  const result = await db.query<{ raw_sha256: string; source_commit: string }>(
    `SELECT f.raw_sha256, s.source_commit FROM source_snapshot_files f JOIN source_snapshots s ON s.id = f.source_snapshot_id JOIN hero_catalog_dataset_versions v ON v.source_snapshot_id = f.source_snapshot_id WHERE v.id = $1 AND f.source_path = 'steam.inf'`,
    [dataset],
  );
  const record = result.rows[0];
  if (!record || record.source_commit !== commit) return null;
  const roots = [
    resolve(
      process.env.DOTA_VPK_WORKTREE_ROOT || ".medota2/cache/worktrees",
      commit,
    ),
    process.env.DOTA_VPK_UPDATES_PATH,
  ].filter((root): root is string => Boolean(root));
  const key = JSON.stringify([roots, commit, record.raw_sha256]);
  const cached = versions.get(key);
  if (cached) return cached;
  for (const root of roots) {
    try {
      const read = async (path: string) =>
        (
          await exec("git", ["-C", root, "show", `${commit}:${path}`], {
            encoding: "utf8",
            timeout: 3000,
            maxBuffer: 2 * 1024 * 1024,
          })
        ).stdout;
      const steam = await read("steam.inf");
      if (
        createHash("sha256").update(steam).digest("hex") !== record.raw_sha256
      )
        continue;
      const version = parseGameplayVersion(
        await read("scripts/change_log.txt"),
        steam,
      );
      if (version) {
        if (versions.size >= 16) versions.delete(versions.keys().next().value!);
        versions.set(key, version);
      }
      return version;
    } catch {
      /* Optional local source unavailable: report an unknown patch. */
    }
  }
  return null;
}

export function parseGameplayVersion(
  changelog: string,
  steam: string,
): string | null {
  const date = /^VersionDate=(.+)$/mu.exec(steam)?.[1]?.trim();
  const buildDate = date ? Date.parse(`${date} 23:59:59 GMT`) : NaN;
  if (!Number.isFinite(buildDate)) return null;
  const root = parseKeyValues(changelog).entries.find(
    (entry) => entry.key === "change_log.txt",
  )?.value;
  if (!root || typeof root === "string") return null;
  const patches = root.entries.flatMap((entry) => {
    if (entry.key !== "change" || typeof entry.value === "string") return [];
    const field = (name: string) =>
      entry.value && typeof entry.value === "object"
        ? entry.value.entries.find((item) => item.key === name)?.value
        : undefined;
    const name = field("patch_name");
    const timestamp = Number(field("date")) * 1000;
    return typeof name === "string" &&
      /^\d+\.\d+[a-z]?$/u.test(name) &&
      Number.isFinite(timestamp) &&
      timestamp <= buildDate
      ? [{ name, timestamp }]
      : [];
  });
  return patches.sort((a, b) => b.timestamp - a.timestamp)[0]?.name ?? null;
}
