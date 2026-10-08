import type { PreparedEntityAsset } from "@/domain/assets";
import { canonicalJsonSha256, sha256 } from "@/lib/hash";
import { buildVariants } from "./catalog-assets";
import {
  readSteamStaticSource,
  STEAM_STATIC_SOURCE,
} from "./steam-static-assets";
export const HERO_MINIMAP_PROVIDER = "hero-minimap-icons-v1";
export async function prepareHeroMinimapAssets(keys: string[]) {
  if (
    !keys.length ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !/^npc_dota_hero_[a-z0-9_]+$/u.test(key))
  )
    throw new Error("Minimap hero keys must be valid, nonempty and unique.");
  const assets: PreparedEntityAsset[] = [];
  let next = 0;
  const missing: string[] = [];
  const run = async () => {
    while (next < keys.length) {
      const key = keys[next++];
      const path = `/apps/dota2/images/dota_react/heroes/icons/${key.slice(14)}.png`;
      const source = await readSteamStaticSource(path);
      if (!source) {
        missing.push(key);
        continue;
      }
      // Native icons include 32×31 artwork (Muerta); preserve their dimensions.
      const hash = sha256(source.bytes),
        variants = await buildVariants(source);
      const metadata = {
        hero_key: key,
        source_repository: STEAM_STATIC_SOURCE,
        source_commit: null,
        source_path: source.logicalPath,
        source_url: source.sourceUrl,
        source_sha256: hash,
        client_version: null,
        imported_at: new Date().toISOString(),
        importer_version: HERO_MINIMAP_PROVIDER,
        schema_version: "hero-minimap-manifest/1",
        version_note:
          "Artwork is not verified against the Catalog client build.",
      };
      assets.push({
        entityType: "hero",
        entityKey: key,
        assetKind: "icon",
        requestedLogicalPath: path,
        resolvedLogicalPath: source.logicalPath,
        resolutionKind: "exact",
        sourceStatus: "available",
        sourceRepository: STEAM_STATIC_SOURCE,
        sourceCommit: null,
        clientVersion: null,
        sourceContentSha256: hash,
        objectSha256: canonicalJsonSha256({
          provider: HERO_MINIMAP_PROVIDER,
          key,
          url: source.sourceUrl,
          hash,
          variants: variants.map((v) => v.contentSha256),
        }),
        providerVersion: HERO_MINIMAP_PROVIDER,
        metadata,
        variants,
      });
    }
  };
  await Promise.all(Array.from({ length: 8 }, run));
  if (missing.length)
    throw new Error(
      `Missing native hero minimap icons: ${missing.sort().join(", ")}`,
    );
  return assets.sort((a, b) => a.entityKey.localeCompare(b.entityKey));
}
