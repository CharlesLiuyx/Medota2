import "server-only";
import { cache as requestCache } from "react";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/config/env";
import { parseKeyValues } from "@/importers/keyvalues/parser";
import { getWebDatabase } from "@/server/db/client";

// The supplemental tooltip labels must belong to the SAME immutable snapshot.
// Never read an unverified neighbouring checkout or fetch a newer game version.
export const getGameLocalization = requestCache(
  async function getGameLocalization(
    dataset: string,
    commit: string | null,
    locale: string,
  ): Promise<Record<string, string>> {
    loadLocalEnv();
    const path = `resource/localization/abilities_${locale === "en" ? "english" : "schinese"}.txt`;
    const db = await getWebDatabase();
    const result = await db.query<{
      raw_sha256: string;
      source_commit: string;
    }>(
      `SELECT f.raw_sha256, s.source_commit FROM source_snapshot_files f JOIN source_snapshots s ON s.id = f.source_snapshot_id JOIN hero_catalog_dataset_versions v ON v.source_snapshot_id = f.source_snapshot_id WHERE v.id = $1 AND f.source_path = $2`,
      [dataset, path],
    );
    const hash = result.rows[0]?.raw_sha256;
    const sourceCommit = result.rows[0]?.source_commit;
    if (
      !hash ||
      !/^[a-f0-9]{40}$/u.test(sourceCommit ?? "") ||
      (commit && commit !== sourceCommit)
    )
      return {};
    const roots = [
      resolve(
        process.env.DOTA_VPK_WORKTREE_ROOT || ".medota2/cache/worktrees",
        sourceCommit,
      ),
      process.env.DOTA_VPK_UPDATES_PATH,
    ].filter((v): v is string => Boolean(v));
    for (const root of roots) {
      try {
        const data = await readFile(resolve(root, path));
        if (createHash("sha256").update(data).digest("hex") !== hash) continue;
        if (cache.has(hash)) return cache.get(hash)!;
        const parsed = parseKeyValues(
          data.toString("utf8").replace(/^\uFEFF/u, ""),
        );
        const language = parsed.entries.find(
          (e) => e.key.toLowerCase() === "lang",
        )?.value;
        const tokens =
          typeof language === "object"
            ? language.entries.find((e) => e.key.toLowerCase() === "tokens")
                ?.value
            : undefined;
        const index: Record<string, string> = {};
        if (typeof tokens === "object")
          for (const entry of tokens.entries)
            if (typeof entry.value === "string")
              index[entry.key.toLowerCase()] = entry.value;
        if (cache.size >= 4) cache.delete(cache.keys().next().value!);
        cache.set(hash, index);
        return index;
      } catch {
        /* Missing optional source: use stored descriptions and known labels. */
      }
    }
    return {};
  },
);
const cache = new Map<string, Record<string, string>>();
