import { pinnedVpkRoots } from "@/importers/dota-vpk/source-roots";
import "server-only";
import { cache as requestCache } from "react";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/config/env";
import { unitTokens } from "@/importers/dota-vpk/unit-adapter";
import { supplementEntityNames } from "@/domain/entity-names";
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
    const roots = pinnedVpkRoots(sourceCommit);
    for (const root of roots) {
      try {
        const data = await readFile(resolve(root, path));
        if (createHash("sha256").update(data).digest("hex") !== hash) continue;
        if (cache.has(hash))
          return supplementEntityNames(cache.get(hash)!, sourceCommit, locale);
        const index = unitTokens(data.toString("utf8"));
        if (cache.size >= 4) cache.delete(cache.keys().next().value!);
        cache.set(hash, index);
        return supplementEntityNames(index, sourceCommit, locale);
      } catch {
        /* Missing optional source: use stored descriptions and known labels. */
      }
    }
    return supplementEntityNames({}, sourceCommit, locale);
  },
);
const cache = new Map<string, Record<string, string>>();
