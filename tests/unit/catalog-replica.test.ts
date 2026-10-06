import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { partitionReplica } from "@/server/services/catalog-replica";
import {
  queryReplica,
  type ReplicaEntry,
  type ReplicaIdentity,
} from "@/domain/catalog-replica";
import { createSearchIndex } from "@/domain/search";
import { parseHeroFilters } from "@/server/services/hero-filters";

it("updates only one content bucket for an edited hero and reuses all blocks on an asset-only update", () => {
  const identity: ReplicaIdentity = {
    entity: "heroes",
    locale: "zh-CN",
    datasetVersionId: "catalog-one",
    assetDatasetVersionId: "assets-one",
  };
  const docs = createSearchIndex([
    { id: "1", names: ["敌法师", "Anti-Mage"], aliases: ["AM"] },
    { id: "2", names: ["斧王", "Axe"] },
  ]).documents;
  const entries = docs.map((search, index) => ({
    id: search.id,
    search,
    row: {
      heroId: index + 1,
      internalName: index ? "npc_dota_hero_axe" : "npc_dota_hero_antimage",
      slug: index ? "axe" : "antimage",
      primaryAttribute: index ? "strength" : "agility",
      attackType: "melee",
      faction: "radiant",
      complexity: 1,
      cmEnabled: true,
      baseStrength: "23",
      baseAgility: "24",
      baseIntelligence: "12",
      movementSpeed: "310",
      zhName: index ? "斧王" : "敌法师",
      enName: index ? "Axe" : "Anti-Mage",
      roles: [{ role: "carry", level: 3 }],
    },
  })) satisfies ReplicaEntry[];
  const original = partitionReplica(identity, entries);
  const assetOnly = partitionReplica(
    { ...identity, assetDatasetVersionId: "assets-two" },
    entries,
  );
  expect(assetOnly.manifest.hashes).toEqual(original.manifest.hashes);
  const edited = structuredClone(entries);
  edited[0].row.movementSpeed = "315";
  const next = partitionReplica(
    { ...identity, datasetVersionId: "catalog-two" },
    edited,
  );
  const missing = next.manifest.hashes.filter((hash) => !original.blocks[hash]);
  expect(missing).toHaveLength(1);
  // Assemble the new version using the unchanged local blocks plus the delta.
  const updated = {
    manifest: next.manifest,
    blocks: {
      ...original.blocks,
      ...Object.fromEntries(missing.map((hash) => [hash, next.blocks[hash]])),
    },
  };
  const result = queryReplica(updated, parseHeroFilters({ q: "AM" }).filters);
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ heroId: 1, movementSpeed: "315" });
  expect(
    queryReplica(original, parseHeroFilters({ q: "AM" }).filters).items[0],
  ).toMatchObject({ movementSpeed: "310" });
});
