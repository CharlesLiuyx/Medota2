import { UNIT_ABILITY_ICONS } from "./unit-ability-icons";
import type { UnitDefinition } from "@/domain/units";
import type { PreparedEntityAsset } from "@/domain/assets";
import { buildVariants } from "./catalog-assets";
import {
  readSteamStaticSource,
  STEAM_STATIC_SOURCE,
} from "./steam-static-assets";
import {
  parsePortraitModels,
  readRedotaFile,
  readRedotaPortrait,
  REDOTA_REPOSITORY,
} from "@/importers/redota/portraits";
import { canonicalJsonSha256, sha256 } from "@/lib/hash";

export const UNIT_ASSET_PROVIDER = "unit-portraits-v1";
export type UnitImageResolution =
  "portrait" | "shared_portrait" | "related_icon" | "unavailable";
export interface PreparedUnitBinding {
  key: string;
  resolution: UnitImageResolution;
  objectId?: string;
  asset?: PreparedEntityAsset;
  provenance: Record<string, unknown>;
}
export function unitPortraitAliases(unit: UnitDefinition): string[] {
  const id = unit.internalName;
  const aliases = [
    id.replace(/_upgraded(?:_mega)?$/, ""),
    id.replace(/_?[1-6]$/, ""),
  ];
  if (/^npc_dota_(goodguys|badguys)_tower[1-4](?:_(top|mid|bot))?$/.test(id))
    aliases.push(id.replace(/tower.*$/, "tower"));
  if (/^npc_dota_(goodguys|badguys)_(melee|range)_rax_(top|mid|bot)$/.test(id))
    aliases.push(id.replace(/_(top|mid|bot)$/, ""));
  if (id === "npc_dota_observer_wards") aliases.push("npc_dota_ward_base");
  if (id === "npc_dota_sentry_wards")
    aliases.push("npc_dota_ward_base_truesight");
  return [...new Set(aliases)].filter((x) => x !== id);
}

export async function prepareUnitAssets(
  units: UnitDefinition[],
  relatedIcons: Map<string, { objectId: string; path: string }>,
  portraitCommit?: string,
  previousPortraits = new Map<string, PreparedUnitBinding>(),
) {
  const batch = portraitCommit
    ? await readRedotaFile(portraitCommit, "public/images/portraits/batch.txt")
    : null;
  if (portraitCommit && !batch)
    throw new Error("Pinned portrait mapping is unavailable.");
  const models = parsePortraitModels(batch?.toString("utf8") ?? "");
  type Source = NonNullable<Awaited<ReturnType<typeof readSteamStaticSource>>>;
  const cache = new Map<string, Promise<Source | null>>();
  const read = (key: string, provider: "steam" | "redota") => {
    const identity = `${provider}:${key}`;
    let pending = cache.get(identity);
    if (!pending) {
      pending =
        provider === "steam"
          ? readSteamStaticSource(
              `/apps/dota2/images/dota_react/units/${key}.png`,
            )
          : readRedotaPortrait(portraitCommit!, key);
      cache.set(identity, pending);
    }
    return pending;
  };
  let next = 0;
  const bindings: PreparedUnitBinding[] = [];
  const run = async () => {
    while (next < units.length) {
      const unit = units[next++];
      const previous = previousPortraits.get(unit.internalName);
      if (previous) {
        bindings.push(previous);
        continue;
      }
      let source = await read(unit.internalName, "steam");
      let sourceKey = unit.internalName;
      let provider: "steam" | "redota" = "steam";
      let resolution: UnitImageResolution = "portrait";
      if (!source && portraitCommit) {
        source = await read(unit.internalName, "redota");
        provider = "redota";
      }
      if (!source) {
        const aliases = unitPortraitAliases(unit);
        // Wards share a model but different materials. Never infer their appearance from model alone.
        if (
          unit.model &&
          unit.category !== "ward" &&
          !unit.model.includes("invisiblebox") &&
          unit.category !== "helper"
        ) {
          const key = models.get(unit.model);
          if (key) aliases.push(key);
        }
        for (const key of [...new Set(aliases)]) {
          source = await read(key, "steam");
          provider = "steam";
          if (!source && portraitCommit) {
            source = await read(key, "redota");
            provider = "redota";
          }
          if (source) {
            sourceKey = key;
            resolution = "shared_portrait";
            break;
          }
        }
      }
      if (source) {
        const hash = sha256(source.bytes);
        const variants = await buildVariants(source);
        const provenance = {
          source_repository:
            provider === "steam" ? STEAM_STATIC_SOURCE : REDOTA_REPOSITORY,
          source_commit: provider === "redota" ? portraitCommit : null,
          source_path: source.logicalPath,
          source_url: source.sourceUrl,
          source_sha256: hash,
          source_key: sourceKey,
          imported_at: new Date().toISOString(),
          client_version: null,
          version_note:
            "Artwork is not verified against the catalog client build.",
          importer_version: UNIT_ASSET_PROVIDER,
          schema_version: "unit-assets-v1",
        };
        bindings.push({
          key: unit.internalName,
          resolution,
          provenance,
          asset: {
            entityType: "unit",
            entityKey: unit.internalName,
            assetKind: "icon",
            requestedLogicalPath: `units/${unit.internalName}`,
            resolvedLogicalPath: source.logicalPath,
            resolutionKind: resolution === "portrait" ? "exact" : "alias",
            sourceStatus: "available",
            sourceRepository: provenance.source_repository,
            sourceCommit: provenance.source_commit ?? null,
            clientVersion: null,
            sourceContentSha256: hash,
            objectSha256: canonicalJsonSha256({
              provider: UNIT_ASSET_PROVIDER,
              source: source.sourceUrl,
              hash,
              variants: variants.map((v) => v.contentSha256),
            }),
            providerVersion: UNIT_ASSET_PROVIDER,
            metadata: provenance,
            variants,
          },
        });
      } else {
        const candidates = [
          unit.summonAbility,
          UNIT_ABILITY_ICONS[unit.internalName],
          ...unit.abilities,
        ].filter((s): s is string => Boolean(s));
        const related = candidates.find((key) => relatedIcons.has(key));
        const icon = related ? relatedIcons.get(related)! : null;
        bindings.push({
          key: unit.internalName,
          resolution: icon ? "related_icon" : "unavailable",
          objectId: icon?.objectId,
          provenance: icon
            ? {
                relation: "unit_ability",
                ability: related,
                source_path: icon.path,
              }
            : {
                reason:
                  "No verified portrait or associated native ability icon found in configured sources.",
              },
        });
      }
      if (bindings.length % 50 === 0)
        console.error(
          `Prepared ${bindings.length}/${units.length} unit images`,
        );
    }
  };
  await Promise.all(Array.from({ length: 8 }, run));
  return {
    bindings: bindings.sort((a, b) => a.key.localeCompare(b.key)),
    source: {
      portraitRepository: portraitCommit ? REDOTA_REPOSITORY : null,
      portraitCommit: portraitCommit ?? null,
      mappingSha256: batch ? sha256(batch) : null,
      providerVersion: UNIT_ASSET_PROVIDER,
    },
  };
}
