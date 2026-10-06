import "server-only";
import { createHash } from "node:crypto";
import {
  REPLICA_SCHEMA,
  REPLICA_BUCKETS,
  type CatalogReplica,
  type ReplicaEntry,
  type ReplicaIdentity,
} from "@/domain/catalog-replica";
import {
  getHeroReplicaRows,
  assertCatalogDatasetPairAvailable,
} from "@/server/repositories/heroes";
import { getAbilityReplicaRows } from "@/server/repositories/abilities";
import { parseHeroFilters } from "./hero-filters";
import { parseAbilityFilters } from "./ability-filters";
import { getHeroSearchIndex, getAbilitySearchIndex } from "./catalog-search";
import { getWebDatabase } from "@/server/db/client";

const replicas = new Map<string, Promise<CatalogReplica>>();
export async function getCatalogReplica(
  identity: ReplicaIdentity,
): Promise<CatalogReplica> {
  await assertCatalogDatasetPairAvailable(
    identity.datasetVersionId,
    identity.assetDatasetVersionId,
  );
  const key = JSON.stringify(identity);
  let pending = replicas.get(key);
  if (!pending) {
    pending = build(identity);
    replicas.set(key, pending);
    if (replicas.size > 8) replicas.delete(replicas.keys().next().value!);
    void pending.catch(() => {
      if (replicas.get(key) === pending) replicas.delete(key);
    });
  }
  return pending;
}
async function build(identity: ReplicaIdentity): Promise<CatalogReplica> {
  const request = {
    catalogDatasetVersionId: identity.datasetVersionId,
    assetDatasetVersionId: identity.assetDatasetVersionId,
  };
  let records: ReplicaEntry[];
  if (identity.entity === "heroes") {
    const [rows, index] = await Promise.all([
      getHeroReplicaRows(
        parseHeroFilters({ lang: identity.locale }).filters,
        request,
      ),
      getHeroSearchIndex(identity.datasetVersionId),
    ]);
    const docs = new Map(index.documents.map((doc) => [doc.id, doc]));
    records = rows.map((row) => ({
      id: String(row.heroId),
      row,
      search: docs.get(String(row.heroId))!,
    }));
  } else {
    const db = await getWebDatabase();
    const [rows, index, extras] = await Promise.all([
      getAbilityReplicaRows(
        parseAbilityFilters({ lang: identity.locale, status: "all" }).filters,
        request,
      ),
      getAbilitySearchIndex(identity.datasetVersionId),
      db.query<{
        id: string;
        granted: boolean;
        bindings: NonNullable<ReplicaEntry["bindings"]>;
      }>(
        `SELECT a.internal_name AS id, (a.is_granted_by_scepter OR a.is_granted_by_shard) AS granted,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('slug',h.slug,'internalName',h.internal_name,'relation',b.relation_kind) ORDER BY h.slug,b.relation_kind)
        FROM hero_ability_bindings b JOIN heroes h ON h.dataset_version_id=b.dataset_version_id AND h.hero_id=b.hero_id
        WHERE b.dataset_version_id=a.dataset_version_id AND b.ability_internal_name=a.internal_name), '[]'::jsonb) AS bindings
        FROM abilities a WHERE a.dataset_version_id=$1`,
        [identity.datasetVersionId],
      ),
    ]);
    const docs = new Map(index.documents.map((doc) => [doc.id, doc]));
    const metadata = new Map(extras.rows.map((row) => [row.id, row]));
    records = rows.map((row) => ({
      id: row.internalName,
      row,
      search: docs.get(row.internalName)!,
      bindings: metadata.get(row.internalName)?.bindings ?? [],
      granted: metadata.get(row.internalName)?.granted ?? false,
    }));
  }
  return partitionReplica(identity, records);
}

export function partitionReplica(
  identity: ReplicaIdentity,
  records: ReplicaEntry[],
): CatalogReplica {
  // Stable ID buckets make an insertion/change affect only its bucket, instead
  // of shifting every subsequent page. Asset-only updates reuse every block.
  const buckets: ReplicaEntry[][] = Array.from(
    { length: REPLICA_BUCKETS },
    () => [],
  );
  for (const record of records) {
    if (!record.search) throw new Error("Search replica is incomplete.");
    const bucket =
      createHash("sha256").update(record.id).digest()[0] % REPLICA_BUCKETS;
    buckets[bucket].push(record);
  }
  const blocks: CatalogReplica["blocks"] = {};
  const hashes = buckets.map((bucket) => {
    bucket.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const normalized = JSON.parse(stableJson(bucket)) as ReplicaEntry[];
    const hash = createHash("sha256")
      .update(JSON.stringify(normalized))
      .digest("hex");
    blocks[hash] = normalized;
    return hash;
  });
  return {
    manifest: {
      ...identity,
      schema: REPLICA_SCHEMA,
      hashes,
      total: records.length,
    },
    blocks,
  };
}
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
