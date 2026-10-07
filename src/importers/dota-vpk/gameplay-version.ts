import { pinnedVpkRoots } from "./source-roots";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { loadLocalEnv } from "@/config/env";
import { parseKeyValues } from "@/importers/keyvalues/parser";
const exec = promisify(execFile);
const versions = new Map<string, string>();
export async function readPinnedGameplayVersion(
  commit: string,
  steamSha256: string,
): Promise<string | null> {
  loadLocalEnv();
  if (!/^[a-f0-9]{40}$/u.test(commit)) return null;
  const roots = pinnedVpkRoots(commit);
  const key = JSON.stringify([roots, commit, steamSha256]);
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
      if (createHash("sha256").update(steam).digest("hex") !== steamSha256)
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
