import type { ParsedAbilityDataset } from "./abilities";
import type { CanonicalHero } from "./heroes";
import { canonicalJsonSha256 } from "@/lib/hash";

export type CatalogGate = "green" | "yellow" | "red";

export interface CatalogProjectionEntity {
  key: string;
  fingerprint: string;
  unknownFields?: string[];
  occurrenceCount?: number;
}

export interface CatalogProjection {
  selectorManifestSha256: string;
  heroes: CatalogProjectionEntity[];
  abilities: CatalogProjectionEntity[];
  bindings: CatalogProjectionEntity[];
  idMappings: CatalogProjectionEntity[];
  facets: CatalogProjectionEntity[];
  localizationCoverage: Record<string, number>;
}

export interface CatalogSemanticDiff {
  severity: CatalogGate;
  diffKind: string;
  entityType: string;
  entityKey: string;
  fieldName: string | null;
  beforeValue: unknown;
  afterValue: unknown;
}

export interface CatalogGateResult {
  gate: CatalogGate;
  semanticSha256: string;
  diffs: CatalogSemanticDiff[];
  summary: {
    total: number;
    green: number;
    yellow: number;
    red: number;
    reasons: Record<string, number>;
  };
}

export function projectCatalog(
  heroes: readonly CanonicalHero[],
  abilities: ParsedAbilityDataset,
  selectorManifestSha256: string,
): CatalogProjection {
  const localizations = new Map<string, number>();
  for (const ability of abilities.abilities) {
    if (ability.catalogStatus !== "current") continue;
    for (const localization of ability.localizations) {
      if (localization.displayName) {
        localizations.set(
          localization.locale,
          (localizations.get(localization.locale) ?? 0) + 1,
        );
      }
    }
  }
  return normalizeProjection({
    selectorManifestSha256,
    heroes: heroes.map((hero) => ({
      key: hero.internalName,
      fingerprint: canonicalJsonSha256({
        heroId: hero.heroId,
        source: hero.source.sourceDtoSha256,
      }),
    })),
    abilities: abilities.abilities.map((ability) => ({
      key: ability.internalName,
      fingerprint: canonicalJsonSha256({
        raw: ability.source.rawSha256,
        resolved: ability.source.resolvedSha256,
        status: ability.catalogStatus,
      }),
      unknownFields: ability.source.unknownFields,
      occurrenceCount: ability.source.definitionOccurrences.length,
    })),
    bindings: abilities.bindings.map((binding) => ({
      key: [
        binding.heroId,
        binding.abilityInternalName,
        binding.relationKind,
        binding.sourceSlot,
      ].join("\u001f"),
      fingerprint: canonicalJsonSha256({
        ordinal: binding.ordinal,
        current: binding.isCurrent,
        path: binding.sourcePath,
        line: binding.sourceLine,
      }),
    })),
    idMappings: abilities.idMappings.map((mapping) => ({
      key: [mapping.internalName, mapping.abilityId].join("\u001f"),
      fingerprint: canonicalJsonSha256({
        path: mapping.sourcePath,
        line: mapping.sourceLine,
      }),
    })),
    facets: abilities.facets.map((facet) => ({
      key: [facet.heroId, facet.facetKey].join("\u001f"),
      fingerprint: canonicalJsonSha256(facet.rawDefinition),
    })),
    localizationCoverage: Object.fromEntries(localizations),
  });
}

export function evaluateCatalogGate(
  current: CatalogProjection | null,
  next: CatalogProjection,
): CatalogGateResult {
  const normalized = normalizeProjection(next);
  const diffs: CatalogSemanticDiff[] = [];
  if (current) {
    if (current.selectorManifestSha256 !== normalized.selectorManifestSha256) {
      diffs.push({
        severity: "yellow",
        diffKind: "selector_manifest_changed",
        entityType: "catalog",
        entityKey: "hero_ability_files",
        fieldName: "selectorManifestSha256",
        beforeValue: current.selectorManifestSha256,
        afterValue: normalized.selectorManifestSha256,
      });
    }
    compareEntities(diffs, "hero", current.heroes, normalized.heroes);
    compareEntities(diffs, "ability", current.abilities, normalized.abilities);
    compareEntities(diffs, "binding", current.bindings, normalized.bindings);
    compareEntities(
      diffs,
      "ability_id_mapping",
      current.idMappings,
      normalized.idMappings,
    );
    compareEntities(diffs, "facet", current.facets, normalized.facets);
    for (const locale of new Set([
      ...Object.keys(current.localizationCoverage),
      ...Object.keys(normalized.localizationCoverage),
    ])) {
      const before = current.localizationCoverage[locale] ?? 0;
      const after = normalized.localizationCoverage[locale] ?? 0;
      if (after < before) {
        diffs.push({
          severity: "yellow",
          diffKind: "localization_coverage_decreased",
          entityType: "localization",
          entityKey: locale,
          fieldName: "currentDisplayNames",
          beforeValue: before,
          afterValue: after,
        });
      }
    }
  }
  const summary = {
    total: diffs.length,
    green: diffs.filter((diff) => diff.severity === "green").length,
    yellow: diffs.filter((diff) => diff.severity === "yellow").length,
    red: diffs.filter((diff) => diff.severity === "red").length,
    reasons: Object.fromEntries(
      [...new Set(diffs.map((diff) => diff.diffKind))]
        .sort()
        .map((kind) => [
          kind,
          diffs.filter((diff) => diff.diffKind === kind).length,
        ]),
    ),
  };
  return {
    gate: summary.red > 0 ? "red" : summary.yellow > 0 ? "yellow" : "green",
    semanticSha256: canonicalJsonSha256(normalized),
    diffs,
    summary,
  };
}

function compareEntities(
  diffs: CatalogSemanticDiff[],
  entityType: string,
  beforeEntities: CatalogProjectionEntity[],
  afterEntities: CatalogProjectionEntity[],
): void {
  const before = new Map(beforeEntities.map((entity) => [entity.key, entity]));
  const after = new Map(afterEntities.map((entity) => [entity.key, entity]));
  for (const [key, entity] of before) {
    const candidate = after.get(key);
    if (!candidate) {
      diffs.push({
        severity: "yellow",
        diffKind: `${entityType}_removed`,
        entityType,
        entityKey: key,
        fieldName: null,
        beforeValue: entity,
        afterValue: null,
      });
      continue;
    }
    if (entity.fingerprint !== candidate.fingerprint) {
      diffs.push({
        severity: "green",
        diffKind: `${entityType}_changed`,
        entityType,
        entityKey: key,
        fieldName: "fingerprint",
        beforeValue: entity.fingerprint,
        afterValue: candidate.fingerprint,
      });
    }
    if (
      entityType === "ability" &&
      (canonicalJsonSha256(entity.unknownFields ?? []) !==
        canonicalJsonSha256(candidate.unknownFields ?? []) ||
        entity.occurrenceCount !== candidate.occurrenceCount)
    ) {
      diffs.push({
        severity: "yellow",
        diffKind: "ability_source_shape_changed",
        entityType,
        entityKey: key,
        fieldName: "sourceShape",
        beforeValue: {
          unknownFields: entity.unknownFields ?? [],
          occurrenceCount: entity.occurrenceCount ?? 1,
        },
        afterValue: {
          unknownFields: candidate.unknownFields ?? [],
          occurrenceCount: candidate.occurrenceCount ?? 1,
        },
      });
    }
  }
  for (const [key, entity] of after) {
    if (before.has(key)) continue;
    diffs.push({
      severity: "green",
      diffKind: `${entityType}_added`,
      entityType,
      entityKey: key,
      fieldName: null,
      beforeValue: null,
      afterValue: entity,
    });
  }
}

function normalizeProjection(projection: CatalogProjection): CatalogProjection {
  const sort = (values: CatalogProjectionEntity[]) =>
    [...values].sort((left, right) =>
      Buffer.from(left.key).compare(Buffer.from(right.key)),
    );
  return {
    selectorManifestSha256: projection.selectorManifestSha256,
    heroes: sort(projection.heroes),
    abilities: sort(projection.abilities),
    bindings: sort(projection.bindings),
    idMappings: sort(projection.idMappings),
    facets: sort(projection.facets),
    localizationCoverage: Object.fromEntries(
      Object.entries(projection.localizationCoverage).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  };
}
