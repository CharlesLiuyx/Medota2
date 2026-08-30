import type { HeroLocale, ImportIssue } from "./heroes";

export interface OrderedKeyValuesEntry {
  key: string;
  value: string | OrderedKeyValuesObject;
  line: number;
}

export interface OrderedKeyValuesObject {
  entries: OrderedKeyValuesEntry[];
}

export const ABILITY_RELATION_KINDS = [
  "loadout",
  "talent",
  "draft",
  "facet",
  "declared_in_hero_file",
  "linked",
  "sub_ability",
  "upgrade_granted",
] as const;

export const ABILITY_CATALOG_STATUSES = [
  "current",
  "indirect",
  "defined_unbound",
  "template",
  "deprecated",
] as const;

export const ABILITY_DEFINITION_KINDS = [
  "ability",
  "talent",
  "template",
] as const;

export type AbilityRelationKind = (typeof ABILITY_RELATION_KINDS)[number];
export type AbilityCatalogStatus = (typeof ABILITY_CATALOG_STATUSES)[number];
export type AbilityDefinitionKind = (typeof ABILITY_DEFINITION_KINDS)[number];

export interface AbilityLocalization {
  locale: HeroLocale;
  displayName: string | null;
  description: string | null;
  lore: string | null;
  scepterDescription: string | null;
  shardDescription: string | null;
  sourcePath: string;
  nameToken: string;
  descriptionToken: string;
  loreToken: string;
  scepterToken: string;
  shardToken: string;
}

export interface AbilityValue {
  valueKey: string;
  ordinal: number;
  scalarValue: string | null;
  levelValues: string[];
  modifiers: Array<{
    key: string;
    value: string | OrderedKeyValuesObject;
    line: number;
  }>;
  rawValue: string | OrderedKeyValuesObject;
}

export interface CanonicalAbility {
  internalName: string;
  definitionKind: AbilityDefinitionKind;
  catalogStatus: AbilityCatalogStatus;
  abilityType: string | null;
  behavior: string[];
  unitTargetTeam: string[];
  unitTargetType: string[];
  unitTargetFlags: string[];
  damageType: string | null;
  spellImmunityType: string | null;
  spellDispellableType: string | null;
  maxLevel: number | null;
  isInnate: boolean;
  isPassive: boolean;
  isHidden: boolean;
  isUltimate: boolean;
  hasScepterUpgrade: boolean;
  hasShardUpgrade: boolean;
  isGrantedByScepter: boolean;
  isGrantedByShard: boolean;
  castRange: string | null;
  castPoint: string | null;
  channelTime: string | null;
  cooldown: string | null;
  manaCost: string | null;
  damage: string | null;
  textureName: string;
  baseClass: string | null;
  values: AbilityValue[];
  localizations: AbilityLocalization[];
  source: {
    declarationKind: "top_level" | "implicit_talent";
    path: string;
    line: number;
    declaredHero: string | null;
    definitionOccurrences: Array<{
      path: string;
      line: number;
      declaredHero: string | null;
      rawDefinition: string | OrderedKeyValuesObject;
      rawSha256: string;
    }>;
    rawDefinition: string | OrderedKeyValuesObject;
    resolvedDefinition: string | OrderedKeyValuesObject;
    rawSha256: string;
    resolvedSha256: string;
    unknownFields: string[];
  };
}

export interface AbilityIdMapping {
  internalName: string;
  abilityId: number;
  sourcePath: string;
  sourceLine: number;
}

export interface HeroAbilityBinding {
  heroId: number;
  heroInternalName: string;
  abilityInternalName: string;
  sourceSlot: string;
  relationKind: AbilityRelationKind;
  ordinal: number;
  isCurrent: boolean;
  sourcePath: string;
  sourceLine: number;
}

export interface CanonicalFacet {
  heroId: number;
  heroInternalName: string;
  facetKey: string;
  icon: string | null;
  color: string | null;
  gradientId: number | null;
  deprecated: boolean;
  rawDefinition: OrderedKeyValuesObject;
  sourcePath: string;
  sourceLine: number;
}

export interface ParsedAbilityDataset {
  abilities: CanonicalAbility[];
  idMappings: AbilityIdMapping[];
  bindings: HeroAbilityBinding[];
  facets: CanonicalFacet[];
  issues: ImportIssue[];
  counts: {
    definitions: number;
    sourceDefinitions: number;
    implicitDefinitions: number;
    accepted: number;
    excluded: number;
    idMappings: number;
    bindings: number;
    facets: number;
    current: number;
    indirect: number;
    definedUnbound: number;
    templates: number;
    deprecated: number;
    warnings: number;
    blockingErrors: number;
  };
}

export class AbilityImportValidationError extends Error {
  constructor(
    message: string,
    readonly issues: ImportIssue[],
    readonly counts?: ParsedAbilityDataset["counts"],
  ) {
    super(message);
    this.name = "AbilityImportValidationError";
  }
}
