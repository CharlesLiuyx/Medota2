import type { ItemDefinition } from "@/domain/items";
import type { PreparedEntityAsset } from "@/domain/assets";
import { canonicalJsonSha256, sha256 } from "@/lib/hash";
import { buildVariants } from "./catalog-assets";
import {
  readSteamStaticSource,
  STEAM_STATIC_SOURCE,
} from "./steam-static-assets";

export const ITEM_ASSET_PROVIDER = "item-icons-v1";
export interface PreparedItemBinding {
  key: string;
  resolution: "icon" | "shared_icon";
  asset: PreparedEntityAsset;
  provenance: Record<string, unknown>;
}
/** Valve's item image convention; recipe definitions use the native recipe icon. */
export function itemImagePath(item: ItemDefinition): string {
  if (!/^item_[a-z0-9_]+$/u.test(item.internalName))
    throw new Error("Invalid item image key.");
  const key =
    item.category === "recipe" ? "recipe" : item.internalName.slice(5);
  return `/apps/dota2/images/dota_react/items/${key}.png`;
}
export async function prepareItemAssets(items: ItemDefinition[]) {
  if (
    !items.length ||
    new Set(items.map((item) => item.internalName)).size !== items.length
  )
    throw new Error("Item asset source keys must be nonempty and unique.");
  const cache = new Map<string, ReturnType<typeof readSteamStaticSource>>();
  const read = (path: string) => {
    let pending = cache.get(path);
    if (!pending) {
      pending = readSteamStaticSource(path);
      cache.set(path, pending);
    }
    return pending;
  };
  const bindings: PreparedItemBinding[] = [];
  const missing: string[] = [];
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const item = items[next++];
      const path = itemImagePath(item);
      const source = await read(path);
      if (!source) {
        missing.push(item.internalName);
        continue;
      }
      const hash = sha256(source.bytes);
      const variants = await buildVariants(source);
      const shared = item.category === "recipe";
      const provenance = {
        source_repository: STEAM_STATIC_SOURCE,
        source_commit: null,
        source_path: source.logicalPath,
        source_url: source.sourceUrl,
        source_sha256: hash,
        imported_at: new Date().toISOString(),
        client_version: null,
        version_note:
          "Artwork is not verified against the catalog client build.",
        mapping: shared ? "native_recipe_icon" : "item_internal_name",
        importer_version: ITEM_ASSET_PROVIDER,
        schema_version: "item-assets-v1",
      };
      bindings.push({
        key: item.internalName,
        resolution: shared ? "shared_icon" : "icon",
        provenance,
        asset: {
          entityType: "item",
          entityKey: item.internalName,
          assetKind: "icon",
          requestedLogicalPath: `items/${item.internalName}`,
          resolvedLogicalPath: source.logicalPath,
          resolutionKind: shared ? "alias" : "exact",
          sourceStatus: "available",
          sourceRepository: STEAM_STATIC_SOURCE,
          sourceCommit: null,
          clientVersion: null,
          sourceContentSha256: hash,
          objectSha256: canonicalJsonSha256({
            provider: ITEM_ASSET_PROVIDER,
            source: source.sourceUrl,
            hash,
            variants: variants.map((v) => v.contentSha256),
          }),
          providerVersion: ITEM_ASSET_PROVIDER,
          metadata: provenance,
          variants,
        },
      });
    }
  };
  await Promise.all(Array.from({ length: 8 }, run));
  if (missing.length)
    throw new Error(`Missing native item images: ${missing.sort().join(", ")}`);
  return {
    bindings: bindings.sort((a, b) => a.key.localeCompare(b.key)),
    source: {
      providerVersion: ITEM_ASSET_PROVIDER,
      sourceRepository: STEAM_STATIC_SOURCE,
      clientVersion: null,
    },
  };
}
