import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ActiveDatasetMeta } from "./heroes";
import { getWebDatabase } from "@/server/db/client";
import { pinnedVpkRoots } from "@/importers/dota-vpk/source-roots";
import { readHeroSource } from "@/importers/dota-vpk/hero-source";
import { enumAttributeFields } from "@/domain/attribute-enums";
import { sha256 } from "@/lib/hash";
import hullRules from "@/importers/dota-map/hulls-6944.json";
import { heroMinimapUrl } from "@/server/map/hero-icons";
const cache = new Map<
  string,
  Map<string, { imageUrl: string | null; collisionRadius: number | null }>
>();
/** A use-specific projection attached to each hero identity; no Catalog/head mutation. */
export async function getHeroMapAssets(meta: ActiveDatasetMeta) {
  const key = `${meta.datasetVersionId}:${meta.sourceCommit}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const result = new Map<
    string,
    { imageUrl: string | null; collisionRadius: number | null }
  >();
  const db = await getWebDatabase();
  const rows = await db.query<{ source_path: string; raw_sha256: string }>(
    `SELECT f.source_path, f.raw_sha256 FROM source_snapshot_files f JOIN hero_catalog_dataset_versions v ON v.source_snapshot_id=f.source_snapshot_id WHERE v.id=$1`,
    [meta.datasetVersionId],
  );
  const files = rows.rows.filter(
    (f) =>
      f.source_path === "scripts/npc/npc_heroes.txt" ||
      /^scripts\/npc\/heroes\/npc_dota_hero_[a-z0-9_]+\.txt$/u.test(
        f.source_path,
      ),
  );
  const steam = rows.rows.find((f) => f.source_path === "steam.inf");
  if (!steam || !files.length) return result;
  for (const root of pinnedVpkRoots(meta.sourceCommit)) {
    // Immutable database hashes, not the checkout's HEAD or modification time.
    const checked = await Promise.all(
      [steam, ...files].map(async (f) => {
        const bytes = await readFile(resolve(root, f.source_path)).catch(
          () => null,
        );
        if (!bytes || sha256(bytes) !== f.raw_sha256) return null;
        return {
          path: f.source_path,
          bytes,
          text: bytes.toString("utf8"),
          sha256: f.raw_sha256,
          sizeBytes: bytes.length,
          encoding: "utf-8" as const,
        };
      }),
    );
    if (checked.some((f) => !f)) continue;
    const source = readHeroSource(checked.filter((f) => f !== null)).root;
    const base = source.entries.find(
      (e) => e.key === "npc_dota_hero_base",
    )?.value;
    const hull = (definition: unknown) =>
      enumAttributeFields(definition).find((f) => f.key === "BoundsHullName")
        ?.value;
    for (const entity of source.entries) {
      if (typeof entity.value === "string") continue;
      const name = (hull(entity.value) ?? hull(base))?.replace(
        "DOTA_HULL_SIZE_",
        "",
      );
      result.set(entity.key, {
        imageUrl: heroMinimapUrl(meta, entity.key),
        collisionRadius:
          meta.clientVersion === hullRules.client_version && name
            ? ((hullRules.hulls as Record<string, number>)[name] ?? null)
            : null,
      });
    }
    if (cache.size >= 4) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
    return result;
  }
  return result;
}
