import { basename } from "node:path";
import {
  AbilityImportValidationError,
  type AbilityCatalogStatus,
  type AbilityDefinitionKind,
  type AbilityIdMapping,
  type AbilityLocalization,
  type AbilityRelationKind,
  type AbilityValue,
  type CanonicalAbility,
  type CanonicalFacet,
  type HeroAbilityBinding,
  type ParsedAbilityDataset,
} from "@/domain/abilities";
import {
  HERO_LOCALES,
  type CanonicalHero,
  type HeroLocale,
  type ImportIssue,
} from "@/domain/heroes";
import type { CheckedSourceFile } from "@/importers/git-checkout";
import {
  objectEntries,
  parseKeyValues,
  uniqueObject,
  type KeyValuesEntry,
  type KeyValuesObject,
} from "@/importers/keyvalues/parser";
import { canonicalJsonSha256 } from "@/lib/hash";
import {
  ABILITY_EXTERNAL_BASE_FALLBACKS,
  HERO_ABILITY_SOURCE_PATTERN,
} from "./constants";

const HEROES_PATH = "scripts/npc/npc_heroes.txt";
const ABILITIES_PATH = "scripts/npc/npc_abilities.txt";
const ABILITY_IDS_PATH = "scripts/npc/npc_ability_ids.txt";
const ABILITY_SLOT = /^Ability(\d+)$/u;
const INTEGER = /^-?\d+$/u;

const KNOWN_ABILITY_KEYS = new Set([
  "BaseClass",
  "AbilityType",
  "AbilityBehavior",
  "AbilityUnitTargetTeam",
  "AbilityUnitTargetType",
  "AbilityUnitTargetFlags",
  "AbilityUnitDamageType",
  "SpellImmunityType",
  "SpellDispellableType",
  "MaxLevel",
  "Innate",
  "Deprecated",
  "HasScepterUpgrade",
  "HasShardUpgrade",
  "IsGrantedByScepter",
  "IsGrantedByShard",
  "AbilityCastRange",
  "AbilityCastPoint",
  "AbilityChannelTime",
  "AbilityCooldown",
  "AbilityManaCost",
  "AbilityDamage",
  "AbilityTextureName",
  "AbilityValues",
  "LinkedAbility",
  "SubAbilityNames",
  "AbilityDraftExtraAbilities",
  "AbilityDraftUltShardAbility",
]);

interface DefinitionRecord {
  internalName: string;
  declarationKind: "top_level" | "implicit_talent";
  implicitBase: string | null;
  raw: string | KeyValuesObject;
  sourcePath: string;
  sourceLine: number;
  declaredHero: string | null;
  occurrences: Array<{
    raw: string | KeyValuesObject;
    sourcePath: string;
    sourceLine: number;
    declaredHero: string | null;
  }>;
}

interface ResolvedDefinition extends DefinitionRecord {
  resolved: string | KeyValuesObject;
  baseClass: string | null;
}

type TokenIndex = Map<string, KeyValuesEntry[]>;

export function parseAbilityDataset(
  files: readonly CheckedSourceFile[],
  heroes: readonly CanonicalHero[],
): ParsedAbilityDataset {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const issues: ImportIssue[] = [];
  const collected = collectDefinitions(files, issues);
  const definitions = collected.definitions;
  const sourceDefinitions = definitions.size;
  collectImplicitTalentDefinitions(
    requiredFile(byPath, HEROES_PATH),
    heroes,
    definitions,
  );
  const resolved = resolveDefinitions(definitions, issues);
  const idMappings = parseAbilityIdMappings(
    requiredFile(byPath, ABILITY_IDS_PATH),
    issues,
  );
  const heroResult = parseHeroRelations(
    requiredFile(byPath, HEROES_PATH),
    heroes,
    resolved,
    issues,
  );
  const localizations = readAbilityLocalizations(byPath, issues);
  const baseClassNames = new Set(
    [...resolved.values()]
      .map((definition) => definition.baseClass)
      .filter((name): name is string => Boolean(name)),
  );
  baseClassNames.add("ability_base");
  baseClassNames.add("dota_base_ability");
  baseClassNames.add("dota_empty_ability");
  baseClassNames.add("special_bonus_base");

  const bindings = deriveDefinitionRelations(
    resolved,
    heroes,
    heroResult.bindings,
    issues,
  );
  validateDirectBindingTargets(bindings, resolved, issues);

  const statuses = deriveStatuses(resolved, bindings, baseClassNames);
  const abilities = [...resolved.values()]
    .map((definition) =>
      mapAbility(
        definition,
        statuses.get(definition.internalName) ?? "defined_unbound",
        baseClassNames,
        localizations,
        issues,
      ),
    )
    .sort((left, right) => byteSort(left.internalName, right.internalName));

  const counts = {
    definitions: sourceDefinitions,
    sourceDefinitions,
    implicitDefinitions: definitions.size - sourceDefinitions,
    accepted: abilities.length,
    excluded: collected.excluded,
    idMappings: idMappings.length,
    bindings: bindings.length,
    facets: heroResult.facets.length,
    current: abilities.filter((ability) => ability.catalogStatus === "current")
      .length,
    indirect: abilities.filter(
      (ability) => ability.catalogStatus === "indirect",
    ).length,
    definedUnbound: abilities.filter(
      (ability) => ability.catalogStatus === "defined_unbound",
    ).length,
    templates: abilities.filter(
      (ability) => ability.catalogStatus === "template",
    ).length,
    deprecated: abilities.filter(
      (ability) => ability.catalogStatus === "deprecated",
    ).length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    blockingErrors: issues.filter((issue) => issue.severity === "blocking")
      .length,
  };

  if (counts.blockingErrors > 0) {
    throw new AbilityImportValidationError(
      `Ability dataset has ${counts.blockingErrors} blocking validation error(s).`,
      issues,
      counts,
    );
  }

  return {
    abilities,
    idMappings,
    bindings,
    facets: heroResult.facets,
    issues,
    counts,
  };
}

function collectDefinitions(
  files: readonly CheckedSourceFile[],
  issues: ImportIssue[],
): { definitions: Map<string, DefinitionRecord>; excluded: number } {
  const sources = files.filter(
    (file) =>
      file.path === ABILITIES_PATH ||
      HERO_ABILITY_SOURCE_PATTERN.test(file.path),
  );
  if (!sources.some((file) => file.path === ABILITIES_PATH)) {
    throw new Error(
      `Required checked source file was not provided: ${ABILITIES_PATH}`,
    );
  }

  const definitions = new Map<string, DefinitionRecord>();
  let excluded = 0;
  for (const file of sources) {
    const root = uniqueObject(parseKeyValues(file.text), "DOTAAbilities");
    const declaredHero = HERO_ABILITY_SOURCE_PATTERN.test(file.path)
      ? basename(file.path, ".txt")
      : null;
    for (const entry of root.entries) {
      if (entry.key === "Version") continue;
      if (typeof entry.value === "string") {
        excluded += 1;
        issues.push({
          severity: "expected_exclusion",
          code: "top_level_ability_default",
          message: `${entry.key} is a top-level scalar default, not an Ability definition object.`,
          sourceKey: entry.key,
          sourcePath: file.path,
        });
        continue;
      }
      const previous = definitions.get(entry.key);
      const occurrence = {
        raw: entry.value,
        sourcePath: file.path,
        sourceLine: entry.line,
        declaredHero,
      };
      if (previous) {
        issues.push({
          severity: "warning",
          code: "duplicate_ability_definition",
          message: `Ability ${entry.key} is defined more than once; the last occurrence is effective.`,
          sourceKey: entry.key,
          sourcePath: file.path,
        });
        definitions.set(entry.key, {
          internalName: entry.key,
          declarationKind: "top_level",
          implicitBase: null,
          ...occurrence,
          sourcePath: occurrence.sourcePath,
          sourceLine: occurrence.sourceLine,
          occurrences: [...previous.occurrences, occurrence],
        });
      } else {
        definitions.set(entry.key, {
          internalName: entry.key,
          declarationKind: "top_level",
          implicitBase: null,
          ...occurrence,
          sourcePath: occurrence.sourcePath,
          sourceLine: occurrence.sourceLine,
          occurrences: [occurrence],
        });
      }
    }
  }
  return { definitions, excluded };
}

function collectImplicitTalentDefinitions(
  file: CheckedSourceFile,
  heroes: readonly CanonicalHero[],
  definitions: Map<string, DefinitionRecord>,
): void {
  const root = uniqueObject(parseKeyValues(file.text), "DOTAHeroes");
  for (const hero of heroes) {
    const matches = objectEntries(root, hero.internalName);
    if (matches.length !== 1 || typeof matches[0].value === "string") continue;
    for (const entry of matches[0].value.entries) {
      if (
        !ABILITY_SLOT.test(entry.key) ||
        typeof entry.value !== "string" ||
        !isTalentName(entry.value)
      ) {
        continue;
      }
      const previous = definitions.get(entry.value);
      if (previous) {
        if (previous.declarationKind === "implicit_talent") {
          previous.occurrences.push({
            raw: entry.value,
            sourcePath: file.path,
            sourceLine: entry.line,
            declaredHero: hero.internalName,
          });
        }
        continue;
      }
      definitions.set(entry.value, {
        internalName: entry.value,
        declarationKind: "implicit_talent",
        implicitBase: "special_bonus_base",
        raw: entry.value,
        sourcePath: file.path,
        sourceLine: entry.line,
        declaredHero: hero.internalName,
        occurrences: [
          {
            raw: entry.value,
            sourcePath: file.path,
            sourceLine: entry.line,
            declaredHero: hero.internalName,
          },
        ],
      });
    }
  }
}

function resolveDefinitions(
  definitions: Map<string, DefinitionRecord>,
  issues: ImportIssue[],
): Map<string, ResolvedDefinition> {
  const resolved = new Map<string, ResolvedDefinition>();
  const resolving = new Set<string>();

  const resolveOne = (name: string): ResolvedDefinition => {
    const cached = resolved.get(name);
    if (cached) return cached;
    const definition = definitions.get(name);
    if (!definition) throw new Error(`Unknown ability definition: ${name}`);
    if (resolving.has(name)) {
      issues.push(
        blocking(
          "ability_inheritance_cycle",
          `Ability BaseClass cycle at ${name}.`,
          {
            sourceKey: name,
            sourcePath: definition.sourcePath,
          },
        ),
      );
      return { ...definition, resolved: definition.raw, baseClass: null };
    }

    resolving.add(name);
    const explicitBase = scalar(definition.raw, "BaseClass");
    const baseClass =
      definition.implicitBase ??
      explicitBase ??
      (name !== "ability_base" && typeof definition.raw !== "string"
        ? "ability_base"
        : null);
    let resolvedValue = definition.raw;
    if (baseClass && typeof definition.raw !== "string") {
      const base = definitions.get(baseClass);
      if (!base) {
        const fallback = ABILITY_EXTERNAL_BASE_FALLBACKS.get(baseClass);
        if (fallback && definitions.has(fallback)) {
          const baseResolved = resolveOne(fallback).resolved;
          if (typeof baseResolved !== "string") {
            resolvedValue = mergeObjects(baseResolved, definition.raw);
          }
        } else {
          issues.push(
            blocking(
              "missing_ability_base",
              `${name} references missing BaseClass ${baseClass}.`,
              { sourceKey: name, sourcePath: definition.sourcePath },
            ),
          );
        }
      } else {
        const baseResolved = resolveOne(baseClass).resolved;
        if (typeof baseResolved !== "string") {
          resolvedValue = mergeObjects(baseResolved, definition.raw);
        }
      }
    }
    resolving.delete(name);
    const result = { ...definition, resolved: resolvedValue, baseClass };
    resolved.set(name, result);
    return result;
  };

  for (const name of definitions.keys()) resolveOne(name);
  return resolved;
}

function mergeObjects(
  base: KeyValuesObject,
  own: KeyValuesObject,
): KeyValuesObject {
  const overridden = new Set(own.entries.map((entry) => entry.key));
  return {
    entries: [
      ...base.entries.filter((entry) => !overridden.has(entry.key)),
      ...own.entries,
    ],
  };
}

function parseAbilityIdMappings(
  file: CheckedSourceFile,
  issues: ImportIssue[],
): AbilityIdMapping[] {
  const root = uniqueObject(parseKeyValues(file.text), "DOTAAbilityIDs");
  const unitAbilities = uniqueObject(root, "UnitAbilities");
  const mappings: AbilityIdMapping[] = [];
  collectIdEntries(unitAbilities, file.path, mappings, issues);

  const names = new Map<string, Set<number>>();
  const ids = new Map<number, Set<string>>();
  for (const mapping of mappings) {
    const nameIds = names.get(mapping.internalName) ?? new Set<number>();
    nameIds.add(mapping.abilityId);
    names.set(mapping.internalName, nameIds);
    const idNames = ids.get(mapping.abilityId) ?? new Set<string>();
    idNames.add(mapping.internalName);
    ids.set(mapping.abilityId, idNames);
  }
  for (const [name, values] of names) {
    if (values.size > 1) {
      issues.push({
        severity: "warning",
        code: "ability_name_multiple_ids",
        message: `${name} maps to multiple numeric Ability IDs: ${[...values].join(", ")}.`,
        sourceKey: name,
        sourcePath: file.path,
      });
    }
  }
  for (const [id, values] of ids) {
    if (values.size > 1) {
      issues.push({
        severity: "warning",
        code: "ability_id_collision",
        message: `Ability ID ${id} maps to multiple names: ${[...values].join(", ")}.`,
        sourcePath: file.path,
      });
    }
  }
  return mappings.sort(
    (left, right) =>
      left.abilityId - right.abilityId ||
      byteSort(left.internalName, right.internalName) ||
      left.sourceLine - right.sourceLine,
  );
}

function collectIdEntries(
  object: KeyValuesObject,
  sourcePath: string,
  mappings: AbilityIdMapping[],
  issues: ImportIssue[],
): void {
  for (const entry of object.entries) {
    if (typeof entry.value !== "string") {
      collectIdEntries(entry.value, sourcePath, mappings, issues);
      continue;
    }
    if (!/^\d+$/u.test(entry.value)) {
      issues.push(
        blocking(
          "invalid_ability_id",
          `${entry.key} has invalid Ability ID ${entry.value}.`,
          { sourceKey: entry.key, sourcePath },
        ),
      );
      continue;
    }
    const abilityId = Number(entry.value);
    if (!Number.isSafeInteger(abilityId)) {
      issues.push(
        blocking("unsafe_ability_id", `${entry.key} Ability ID is unsafe.`, {
          sourceKey: entry.key,
          sourcePath,
        }),
      );
      continue;
    }
    mappings.push({
      internalName: entry.key,
      abilityId,
      sourcePath,
      sourceLine: entry.line,
    });
  }
}

function parseHeroRelations(
  file: CheckedSourceFile,
  heroes: readonly CanonicalHero[],
  definitions: Map<string, ResolvedDefinition>,
  issues: ImportIssue[],
): { bindings: HeroAbilityBinding[]; facets: CanonicalFacet[] } {
  const root = uniqueObject(parseKeyValues(file.text), "DOTAHeroes");
  const bindings: HeroAbilityBinding[] = [];
  const facets: CanonicalFacet[] = [];
  const seen = new Set<string>();

  for (const hero of heroes) {
    const matches = objectEntries(root, hero.internalName);
    if (matches.length !== 1 || typeof matches[0].value === "string") {
      issues.push(
        blocking(
          "missing_hero_ability_source",
          `${hero.internalName} does not have one Hero object for Ability bindings.`,
          {
            heroId: hero.heroId,
            sourceKey: hero.internalName,
            sourcePath: file.path,
          },
        ),
      );
      continue;
    }
    const heroObject = matches[0].value;
    for (const entry of heroObject.entries) {
      const slot = ABILITY_SLOT.exec(entry.key);
      if (!slot || typeof entry.value !== "string" || entry.value === "")
        continue;
      addBinding(bindings, seen, {
        heroId: hero.heroId,
        heroInternalName: hero.internalName,
        abilityInternalName: entry.value,
        sourceSlot: entry.key,
        relationKind: isTalentName(entry.value) ? "talent" : "loadout",
        ordinal: Number(slot[1]),
        isCurrent: true,
        sourcePath: file.path,
        sourceLine: entry.line,
      });
    }

    const draftEntries = objectEntries(heroObject, "AbilityDraftAbilities");
    for (const draftEntry of draftEntries) {
      if (typeof draftEntry.value === "string") continue;
      for (const entry of draftEntry.value.entries) {
        const slot = ABILITY_SLOT.exec(entry.key);
        if (!slot || typeof entry.value !== "string" || entry.value === "")
          continue;
        for (const abilityInternalName of entry.value
          .split(/[;,]/u)
          .map((value) => value.trim())
          .filter(Boolean)) {
          addBinding(bindings, seen, {
            heroId: hero.heroId,
            heroInternalName: hero.internalName,
            abilityInternalName,
            sourceSlot: `draft:${entry.key}`,
            relationKind: "draft",
            ordinal: Number(slot[1]),
            isCurrent: false,
            sourcePath: file.path,
            sourceLine: entry.line,
          });
        }
      }
    }

    const facetEntries = objectEntries(heroObject, "Facets");
    for (const facetContainer of facetEntries) {
      if (typeof facetContainer.value === "string") continue;
      for (const entry of facetContainer.value.entries) {
        if (typeof entry.value === "string") {
          issues.push({
            severity: "warning",
            code: "invalid_facet_definition",
            message: `${hero.internalName}.${entry.key} facet is not an object.`,
            heroId: hero.heroId,
            sourceKey: entry.key,
            sourcePath: file.path,
          });
          continue;
        }
        const deprecated = booleanScalar(entry.value, "Deprecated") ?? false;
        const gradient = scalar(entry.value, "GradientID");
        facets.push({
          heroId: hero.heroId,
          heroInternalName: hero.internalName,
          facetKey: entry.key,
          icon: scalar(entry.value, "Icon"),
          color: scalar(entry.value, "Color"),
          gradientId:
            gradient && /^\d+$/u.test(gradient) ? Number(gradient) : null,
          deprecated,
          rawDefinition: entry.value,
          sourcePath: file.path,
          sourceLine: entry.line,
        });
        for (const abilityEntry of collectScalarEntries(
          entry.value,
          "AbilityName",
        )) {
          addBinding(bindings, seen, {
            heroId: hero.heroId,
            heroInternalName: hero.internalName,
            abilityInternalName: abilityEntry.value,
            sourceSlot: `facet:${entry.key}`,
            relationKind: "facet",
            ordinal: 0,
            isCurrent: !deprecated,
            sourcePath: file.path,
            sourceLine: abilityEntry.line,
          });
        }
      }
    }
  }

  for (const definition of definitions.values()) {
    if (!definition.declaredHero) continue;
    const hero = heroes.find(
      (candidate) => candidate.internalName === definition.declaredHero,
    );
    if (!hero) continue;
    addBinding(bindings, seen, {
      heroId: hero.heroId,
      heroInternalName: hero.internalName,
      abilityInternalName: definition.internalName,
      sourceSlot: `file:${definition.sourcePath}`,
      relationKind: "declared_in_hero_file",
      ordinal: definition.sourceLine,
      isCurrent: false,
      sourcePath: definition.sourcePath,
      sourceLine: definition.sourceLine,
    });
  }

  return { bindings, facets };
}

function deriveDefinitionRelations(
  definitions: Map<string, ResolvedDefinition>,
  heroes: readonly CanonicalHero[],
  initialBindings: HeroAbilityBinding[],
  issues: ImportIssue[],
): HeroAbilityBinding[] {
  const bindings = [...initialBindings];
  const seen = new Set(bindings.map(bindingKey));
  const currentOwners = new Map<string, Set<number>>();
  for (const binding of bindings) {
    if (!binding.isCurrent) continue;
    const owners =
      currentOwners.get(binding.abilityInternalName) ?? new Set<number>();
    owners.add(binding.heroId);
    currentOwners.set(binding.abilityInternalName, owners);
  }
  const heroById = new Map(heroes.map((hero) => [hero.heroId, hero]));
  const heroByName = new Map(heroes.map((hero) => [hero.internalName, hero]));

  for (const definition of definitions.values()) {
    if (typeof definition.raw === "string") continue;
    const declaredOwner = definition.declaredHero
      ? heroByName.get(definition.declaredHero)
      : undefined;
    const ownerIds = new Set(currentOwners.get(definition.internalName) ?? []);
    if (declaredOwner) ownerIds.add(declaredOwner.heroId);

    const grantedByScepter = booleanScalar(
      definition.raw,
      "IsGrantedByScepter",
    );
    const grantedByShard = booleanScalar(definition.raw, "IsGrantedByShard");
    if (declaredOwner && (grantedByScepter || grantedByShard)) {
      addBinding(bindings, seen, {
        heroId: declaredOwner.heroId,
        heroInternalName: declaredOwner.internalName,
        abilityInternalName: definition.internalName,
        sourceSlot: grantedByScepter ? "scepter" : "shard",
        relationKind: "upgrade_granted",
        ordinal: definition.sourceLine,
        isCurrent: true,
        sourcePath: definition.sourcePath,
        sourceLine: definition.sourceLine,
      });
    }

    const relations: Array<{
      target: string;
      kind: AbilityRelationKind;
      sourceSlot: string;
      line: number;
    }> = [];
    const linked = scalarEntry(definition.raw, "LinkedAbility");
    if (linked) {
      relations.push({
        target: linked.value,
        kind: "linked",
        sourceSlot: "LinkedAbility",
        line: linked.line,
      });
    }
    const subAbilities = scalarEntry(definition.raw, "SubAbilityNames");
    if (subAbilities) {
      for (const target of subAbilities.value
        .split(/[;,]/u)
        .map((value) => value.trim())
        .filter(Boolean)) {
        relations.push({
          target,
          kind: "sub_ability",
          sourceSlot: "SubAbilityNames",
          line: subAbilities.line,
        });
      }
    }
    for (const draftObject of objectEntries(
      definition.raw,
      "AbilityDraftExtraAbilities",
    )) {
      if (typeof draftObject.value === "string") continue;
      for (const entry of draftObject.value.entries) {
        relations.push({
          target: entry.key,
          kind: "draft",
          sourceSlot: `AbilityDraftExtraAbilities:${entry.value}`,
          line: entry.line,
        });
      }
    }
    const draftShard = scalarEntry(
      definition.raw,
      "AbilityDraftUltShardAbility",
    );
    if (draftShard) {
      relations.push({
        target: draftShard.value,
        kind: "draft",
        sourceSlot: "AbilityDraftUltShardAbility",
        line: draftShard.line,
      });
    }

    for (const relation of relations) {
      if (!definitions.has(relation.target)) {
        issues.push({
          severity: "warning",
          code: "external_ability_relation_target",
          message: `${definition.internalName}.${relation.sourceSlot} references ${relation.target}, which is outside DOTAAbilities.`,
          sourceKey: definition.internalName,
          sourcePath: definition.sourcePath,
        });
        continue;
      }
      for (const ownerId of ownerIds) {
        const owner = heroById.get(ownerId);
        if (!owner) continue;
        addBinding(bindings, seen, {
          heroId: owner.heroId,
          heroInternalName: owner.internalName,
          abilityInternalName: relation.target,
          sourceSlot: `${definition.internalName}:${relation.sourceSlot}`,
          relationKind: relation.kind,
          ordinal: relation.line,
          isCurrent: false,
          sourcePath: definition.sourcePath,
          sourceLine: relation.line,
        });
      }
    }
  }
  return bindings.sort(
    (left, right) =>
      left.heroId - right.heroId ||
      left.ordinal - right.ordinal ||
      byteSort(left.abilityInternalName, right.abilityInternalName) ||
      byteSort(left.relationKind, right.relationKind),
  );
}

function validateDirectBindingTargets(
  bindings: readonly HeroAbilityBinding[],
  definitions: Map<string, ResolvedDefinition>,
  issues: ImportIssue[],
): void {
  for (const binding of bindings) {
    if (definitions.has(binding.abilityInternalName)) continue;
    issues.push(
      blocking(
        "missing_bound_ability_definition",
        `${binding.heroInternalName}.${binding.sourceSlot} references missing Ability ${binding.abilityInternalName}.`,
        {
          heroId: binding.heroId,
          sourceKey: binding.heroInternalName,
          sourcePath: binding.sourcePath,
        },
      ),
    );
  }
}

function deriveStatuses(
  definitions: Map<string, ResolvedDefinition>,
  bindings: readonly HeroAbilityBinding[],
  baseClassNames: Set<string>,
): Map<string, AbilityCatalogStatus> {
  const current = new Set(
    bindings
      .filter((binding) => binding.isCurrent)
      .map((binding) => binding.abilityInternalName),
  );
  const indirect = new Set(
    bindings
      .filter(
        (binding) =>
          !binding.isCurrent &&
          binding.relationKind !== "declared_in_hero_file",
      )
      .map((binding) => binding.abilityInternalName),
  );
  const statuses = new Map<string, AbilityCatalogStatus>();
  for (const definition of definitions.values()) {
    if (booleanScalar(definition.raw, "Deprecated")) {
      statuses.set(definition.internalName, "deprecated");
    } else if (baseClassNames.has(definition.internalName)) {
      statuses.set(definition.internalName, "template");
    } else if (current.has(definition.internalName)) {
      statuses.set(definition.internalName, "current");
    } else if (indirect.has(definition.internalName)) {
      statuses.set(definition.internalName, "indirect");
    } else {
      statuses.set(definition.internalName, "defined_unbound");
    }
  }
  return statuses;
}

function mapAbility(
  definition: ResolvedDefinition,
  catalogStatus: AbilityCatalogStatus,
  baseClassNames: Set<string>,
  localizationIndexes: Map<HeroLocale, { path: string; tokens: TokenIndex }>,
  issues: ImportIssue[],
): CanonicalAbility {
  const resolved = definition.resolved;
  const behavior = flags(scalar(resolved, "AbilityBehavior"));
  const abilityType = scalar(resolved, "AbilityType");
  const isHidden = behavior.includes("DOTA_ABILITY_BEHAVIOR_HIDDEN");
  const localizations = HERO_LOCALES.map((locale) =>
    mapAbilityLocalization(
      definition.internalName,
      locale,
      localizationIndexes.get(locale)!,
    ),
  );
  if (
    catalogStatus === "current" &&
    !isHidden &&
    localizations.find((item) => item.locale === "en")?.displayName === null
  ) {
    issues.push({
      severity: "warning",
      code: "missing_current_ability_name",
      message: `${definition.internalName} is current but has no English display name.`,
      sourceKey: definition.internalName,
      sourcePath: definition.sourcePath,
    });
  }

  return {
    internalName: definition.internalName,
    definitionKind: definitionKind(definition, baseClassNames),
    catalogStatus,
    abilityType,
    behavior,
    unitTargetTeam: flags(scalar(resolved, "AbilityUnitTargetTeam")),
    unitTargetType: flags(scalar(resolved, "AbilityUnitTargetType")),
    unitTargetFlags: flags(scalar(resolved, "AbilityUnitTargetFlags")),
    damageType: scalar(resolved, "AbilityUnitDamageType"),
    spellImmunityType: scalar(resolved, "SpellImmunityType"),
    spellDispellableType: scalar(resolved, "SpellDispellableType"),
    maxLevel: integerScalar(resolved, "MaxLevel"),
    isInnate:
      booleanScalar(resolved, "Innate") === true ||
      behavior.includes("DOTA_ABILITY_BEHAVIOR_INNATE_UI"),
    isPassive: behavior.includes("DOTA_ABILITY_BEHAVIOR_PASSIVE"),
    isHidden,
    isUltimate: abilityType === "ABILITY_TYPE_ULTIMATE",
    hasScepterUpgrade: booleanScalar(resolved, "HasScepterUpgrade") === true,
    hasShardUpgrade: booleanScalar(resolved, "HasShardUpgrade") === true,
    isGrantedByScepter: booleanScalar(resolved, "IsGrantedByScepter") === true,
    isGrantedByShard: booleanScalar(resolved, "IsGrantedByShard") === true,
    castRange: scalar(resolved, "AbilityCastRange"),
    castPoint: scalar(resolved, "AbilityCastPoint"),
    channelTime: scalar(resolved, "AbilityChannelTime"),
    cooldown: scalar(resolved, "AbilityCooldown"),
    manaCost: scalar(resolved, "AbilityManaCost"),
    damage: scalar(resolved, "AbilityDamage"),
    textureName:
      scalar(resolved, "AbilityTextureName") ?? definition.internalName,
    baseClass: definition.baseClass,
    values: mapAbilityValues(resolved),
    localizations,
    source: {
      declarationKind: definition.declarationKind,
      path: definition.sourcePath,
      line: definition.sourceLine,
      declaredHero: definition.declaredHero,
      definitionOccurrences: definition.occurrences.map((occurrence) => ({
        path: occurrence.sourcePath,
        line: occurrence.sourceLine,
        declaredHero: occurrence.declaredHero,
        rawDefinition: occurrence.raw,
        rawSha256: canonicalJsonSha256(occurrence.raw),
      })),
      rawDefinition: definition.raw,
      resolvedDefinition: definition.resolved,
      rawSha256: canonicalJsonSha256(definition.raw),
      resolvedSha256: canonicalJsonSha256(definition.resolved),
      unknownFields:
        typeof definition.raw === "string"
          ? []
          : [
              ...new Set(
                definition.raw.entries
                  .map((entry) => entry.key)
                  .filter((key) => !KNOWN_ABILITY_KEYS.has(key)),
              ),
            ].sort(byteSort),
    },
  };
}

function definitionKind(
  definition: ResolvedDefinition,
  baseClassNames: Set<string>,
): AbilityDefinitionKind {
  if (baseClassNames.has(definition.internalName)) return "template";
  if (
    isTalentName(definition.internalName) ||
    definition.baseClass === "special_bonus_base"
  ) {
    return "talent";
  }
  return "ability";
}

function mapAbilityValues(
  definition: string | KeyValuesObject,
): AbilityValue[] {
  if (typeof definition === "string") return [];
  const containers = objectEntries(definition, "AbilityValues").filter(
    (entry): entry is KeyValuesEntry & { value: KeyValuesObject } =>
      typeof entry.value !== "string",
  );
  return containers.flatMap((container) =>
    container.value.entries.map((entry, ordinal) => {
      if (typeof entry.value === "string") {
        return {
          valueKey: entry.key,
          ordinal,
          scalarValue: entry.value,
          levelValues: splitLevelValues(entry.value),
          modifiers: [],
          rawValue: entry.value,
        };
      }
      const value = scalar(entry.value, "value");
      return {
        valueKey: entry.key,
        ordinal,
        scalarValue: value,
        levelValues: value === null ? [] : splitLevelValues(value),
        modifiers: entry.value.entries
          .filter((modifier) => modifier.key !== "value")
          .map((modifier) => ({
            key: modifier.key,
            value: modifier.value,
            line: modifier.line,
          })),
        rawValue: entry.value,
      };
    }),
  );
}

function readAbilityLocalizations(
  byPath: Map<string, CheckedSourceFile>,
  issues: ImportIssue[],
): Map<HeroLocale, { path: string; tokens: TokenIndex }> {
  return new Map(
    HERO_LOCALES.map((locale) => {
      const fileLocale = locale === "en" ? "english" : "schinese";
      const path = `resource/localization/abilities_${fileLocale}.txt`;
      const root = uniqueObject(
        parseKeyValues(requiredFile(byPath, path).text),
        "lang",
      );
      const tokens = uniqueObject(root, "Tokens");
      const index: TokenIndex = new Map();
      for (const entry of tokens.entries) {
        const matches = index.get(entry.key) ?? [];
        matches.push(entry);
        index.set(entry.key, matches);
      }
      for (const [token, matches] of index) {
        if (matches.length > 1) {
          issues.push({
            severity: "warning",
            code: "duplicate_ability_localization_token",
            message: `${path} contains duplicate token ${token}.`,
            sourcePath: path,
            token,
          });
        }
      }
      return [locale, { path, tokens: index }];
    }),
  );
}

function mapAbilityLocalization(
  internalName: string,
  locale: HeroLocale,
  source: { path: string; tokens: TokenIndex },
): AbilityLocalization {
  const prefix = `DOTA_Tooltip_ability_${internalName}`;
  const nameToken = prefix;
  const descriptionToken = `${prefix}_Description`;
  const loreToken = `${prefix}_Lore`;
  const scepterToken = `${prefix}_scepter_Description`;
  const shardToken = `${prefix}_shard_Description`;
  return {
    locale,
    displayName: tokenValue(source.tokens, nameToken),
    description: tokenValue(source.tokens, descriptionToken),
    lore: tokenValue(source.tokens, loreToken),
    scepterDescription: tokenValue(source.tokens, scepterToken),
    shardDescription: tokenValue(source.tokens, shardToken),
    sourcePath: source.path,
    nameToken,
    descriptionToken,
    loreToken,
    scepterToken,
    shardToken,
  };
}

function tokenValue(index: TokenIndex, token: string): string | null {
  const match = index.get(token)?.at(-1);
  return match && typeof match.value === "string" && match.value !== ""
    ? match.value
    : null;
}

function addBinding(
  bindings: HeroAbilityBinding[],
  seen: Set<string>,
  binding: HeroAbilityBinding,
): void {
  const key = bindingKey(binding);
  if (seen.has(key)) return;
  seen.add(key);
  bindings.push(binding);
}

function bindingKey(binding: HeroAbilityBinding): string {
  return [
    binding.heroId,
    binding.abilityInternalName,
    binding.relationKind,
    binding.sourceSlot,
  ].join("\0");
}

function collectScalarEntries(
  object: KeyValuesObject,
  key: string,
): Array<{ value: string; line: number }> {
  const result: Array<{ value: string; line: number }> = [];
  for (const entry of object.entries) {
    if (entry.key === key && typeof entry.value === "string") {
      result.push({ value: entry.value, line: entry.line });
    }
    if (typeof entry.value !== "string") {
      result.push(...collectScalarEntries(entry.value, key));
    }
  }
  return result;
}

function scalarEntry(
  object: string | KeyValuesObject,
  key: string,
): { value: string; line: number } | null {
  if (typeof object === "string") return null;
  const match = objectEntries(object, key)
    .filter((entry) => typeof entry.value === "string")
    .at(-1);
  return match ? { value: match.value as string, line: match.line } : null;
}

function scalar(object: string | KeyValuesObject, key: string): string | null {
  return scalarEntry(object, key)?.value ?? null;
}

function booleanScalar(
  object: string | KeyValuesObject,
  key: string,
): boolean | null {
  const value = scalar(object, key)?.toLowerCase();
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return null;
}

function integerScalar(
  object: string | KeyValuesObject,
  key: string,
): number | null {
  const value = scalar(object, key);
  if (!value || !INTEGER.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function flags(value: string | null): string[] {
  if (!value || value === "DOTA_ABILITY_BEHAVIOR_NONE") return [];
  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLevelValues(value: string): string[] {
  return value.trim() === "" ? [] : value.trim().split(/\s+/u);
}

function isTalentName(name: string): boolean {
  return (
    name.startsWith("special_bonus_") &&
    name !== "special_bonus_attributes" &&
    name !== "special_bonus_base"
  );
}

function requiredFile(
  byPath: Map<string, CheckedSourceFile>,
  path: string,
): CheckedSourceFile {
  const file = byPath.get(path);
  if (!file) {
    throw new Error(`Required checked source file was not provided: ${path}`);
  }
  return file;
}

function blocking(
  code: string,
  message: string,
  details: Omit<ImportIssue, "severity" | "code" | "message"> = {},
): ImportIssue {
  return { severity: "blocking", code, message, ...details };
}

function byteSort(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}
