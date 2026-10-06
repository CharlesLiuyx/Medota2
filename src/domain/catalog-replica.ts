import type { HeroCardRow } from "@/server/repositories/heroes";
import type { AbilityCardRow } from "@/server/repositories/abilities";
import type { HeroFilters } from "@/server/services/hero-filters";
import type { AbilityFilters } from "@/server/services/ability-filters";
import { searchDocuments, type SearchDocument } from "./search/query";
import type { VersionedListSlice } from "./infinite-list";

export const REPLICA_SCHEMA = 2;
export const REPLICA_BUCKETS = 16;
export type ReplicaEntity = "heroes" | "abilities";
export type ReplicaLocale = "zh-CN" | "en";
export interface ReplicaIdentity {
  entity: ReplicaEntity;
  locale: ReplicaLocale;
  datasetVersionId: string;
  assetDatasetVersionId: string;
}
export interface ReplicaEntry {
  id: string;
  row: HeroCardRow | AbilityCardRow;
  search: SearchDocument;
  bindings?: Array<{ slug: string; internalName: string; relation: string }>;
  granted?: boolean;
}
export interface ReplicaManifest extends ReplicaIdentity {
  schema: typeof REPLICA_SCHEMA;
  hashes: string[];
  total: number;
}
export interface CatalogReplica {
  manifest: ReplicaManifest;
  blocks: Record<string, ReplicaEntry[]>;
}

const rank: Record<string, number> = {
  strength: 0,
  agility: 1,
  intelligence: 2,
  universal: 3,
};
function compareCodepoints(left: string, right: string): number {
  const a = Array.from(left),
    b = Array.from(right);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const diff = a[i].codePointAt(0)! - b[i].codePointAt(0)!;
    if (diff) return diff;
  }
  return a.length - b.length;
}
const prepared = new WeakMap<CatalogReplica, ReplicaEntry[]>();
function entries(replica: CatalogReplica) {
  let rows = prepared.get(replica);
  if (!rows) {
    rows = replica.manifest.hashes.flatMap((hash) => replica.blocks[hash]);
    rows.sort((a, b) => {
      if (replica.manifest.entity === "heroes") {
        const x = a.row as HeroCardRow,
          y = b.row as HeroCardRow;
        return (
          (rank[x.primaryAttribute] ?? 4) - (rank[y.primaryAttribute] ?? 4) ||
          x.heroId - y.heroId
        );
      }
      const x = a.row as AbilityCardRow,
        y = b.row as AbilityCardRow;
      return (
        compareCodepoints(
          x.sortName ?? x.displayName,
          y.sortName ?? y.displayName,
        ) || compareCodepoints(x.internalName, y.internalName)
      );
    });
    prepared.set(replica, rows);
  }
  return rows;
}
export function queryReplica(
  replica: CatalogReplica,
  filters: HeroFilters | AbilityFilters,
): VersionedListSlice<HeroCardRow | AbilityCardRow> {
  const all = entries(replica);
  const matches = filters.q
    ? new Set(
        searchDocuments(
          all.map((e) => e.search),
          filters.q,
        ),
      )
    : null;
  const selected = all.filter((entry) => {
    if (matches && !matches.has(entry.id)) return false;
    if (replica.manifest.entity === "heroes") {
      const row = entry.row as HeroCardRow,
        f = filters as HeroFilters;
      return (
        (!f.attributes.length ||
          f.attributes.includes(
            row.primaryAttribute as HeroFilters["attributes"][number],
          )) &&
        (!f.attacks.length ||
          f.attacks.includes(
            row.attackType as HeroFilters["attacks"][number],
          )) &&
        (!f.roles.length ||
          row.roles.some((r) =>
            f.roles.includes(r.role as HeroFilters["roles"][number]),
          )) &&
        (f.cm === "all" || row.cmEnabled === (f.cm === "true"))
      );
    }
    const row = entry.row as AbilityCardRow,
      f = filters as AbilityFilters;
    return (
      (f.status === "all" || row.catalogStatus === f.status) &&
      (!f.hero ||
        entry.bindings?.some(
          (b) => b.slug === f.hero || b.internalName === f.hero,
        )) &&
      (f.relation === "all" ||
        entry.bindings?.some((b) => b.relation === f.relation)) &&
      (!f.behavior || row.behavior.includes(f.behavior)) &&
      (!f.damage || row.damageType === f.damage) &&
      (f.upgrade === "all" ||
        (f.upgrade === "scepter" && row.hasScepterUpgrade) ||
        (f.upgrade === "shard" && row.hasShardUpgrade) ||
        (f.upgrade === "granted" && entry.granted))
    );
  });
  const groupCounts =
    replica.manifest.entity === "heroes"
      ? selected.reduce<Record<string, number>>(
          (counts, e) => {
            const attribute = (e.row as HeroCardRow).primaryAttribute;
            counts[attribute] = (counts[attribute] ?? 0) + 1;
            return counts;
          },
          { strength: 0, agility: 0, intelligence: 0, universal: 0 },
        )
      : undefined;
  return {
    items: selected.map((e) => e.row),
    total: selected.length,
    previousCursor: null,
    nextCursor: null,
    datasetVersionId: replica.manifest.datasetVersionId,
    assetDatasetVersionId: replica.manifest.assetDatasetVersionId,
    ...(groupCounts ? { groupCounts } : {}),
  };
}
