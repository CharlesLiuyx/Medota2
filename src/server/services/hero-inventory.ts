import "server-only";
import { adaptInventory } from "@/importers/dota-vpk/inventory-adapter";
import { getItemOverview } from "@/server/repositories/items";
import { itemCatalogRows } from "./catalog-projections";
import type { InventoryCatalog } from "@/domain/hero-inventory";

const projections = new WeakMap<object, Map<string, InventoryCatalog>>();
export async function getHeroInventoryCatalog(
  dataset: string,
  primary: string,
) {
  const { meta, snapshot, imageVersion } = await getItemOverview(dataset);
  if (!meta || !snapshot) return { catalog: null, imageVersion };
  const cached =
    projections.get(snapshot) ?? new Map<string, InventoryCatalog>();
  let catalog = cached.get(primary);
  if (!catalog) {
    catalog = adaptInventory(
      snapshot,
      {
        repository: meta.sourceRepository,
        commit: meta.sourceCommit,
        path: "scripts/npc/items.txt",
        clientVersion: meta.clientVersion,
      },
      primary,
    );
    const search = new Map(
      itemCatalogRows(snapshot.items).map((item) => [
        item.internalName,
        item.searchText,
      ]),
    );
    for (const item of [
      ...catalog.items,
      ...catalog.neutralTiers.flatMap((t) => [...t.items, ...t.enchantments]),
    ])
      item.searchText = search.get(item.internalName) ?? item.searchText;
    cached.set(primary, catalog);
    projections.set(snapshot, cached);
  }
  return { catalog, imageVersion };
}
