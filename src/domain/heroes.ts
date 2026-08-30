export const PRIMARY_ATTRIBUTES = [
  "strength",
  "agility",
  "intelligence",
  "universal",
] as const;
export const ATTACK_TYPES = ["melee", "ranged"] as const;
export const FACTIONS = ["radiant", "dire"] as const;
export const HERO_ROLES = [
  "carry",
  "support",
  "nuker",
  "disabler",
  "durable",
  "escape",
  "pusher",
  "initiator",
] as const;
export const HERO_LOCALES = ["en", "zh-CN"] as const;

export type PrimaryAttribute = (typeof PRIMARY_ATTRIBUTES)[number];
export type AttackType = (typeof ATTACK_TYPES)[number];
export type Faction = (typeof FACTIONS)[number];
export type HeroRole = (typeof HERO_ROLES)[number];
export type HeroLocale = (typeof HERO_LOCALES)[number];

export interface ImportIssue {
  severity: "expected_exclusion" | "warning" | "blocking";
  code: string;
  message: string;
  heroId?: number;
  sourceKey?: string;
  sourcePath?: string;
  token?: string;
}

export interface HeroRoleValue {
  role: HeroRole;
  level: number;
}

export interface HeroLocalization {
  locale: HeroLocale;
  displayName: string;
  englishNameVariant: string | null;
  hype: string | null;
  lore: string | null;
  nameSourcePath: string;
  nameToken: string;
  englishNameVariantToken: string | null;
  hypeSourcePath: string | null;
  hypeToken: string | null;
  loreSourcePath: string | null;
  loreToken: string | null;
}

export interface CanonicalHero {
  heroId: number;
  internalName: string;
  slug: string;
  enabled: boolean;
  cmEnabled: boolean;
  randomEnabled: boolean | null;
  primaryAttribute: PrimaryAttribute;
  attackType: AttackType;
  faction: Faction;
  complexity: number;
  baseStrength: string;
  strengthGain: string;
  baseAgility: string;
  agilityGain: string;
  baseIntelligence: string;
  intelligenceGain: string;
  baseHealth: string;
  baseMana: string;
  baseHealthRegen: string;
  baseManaRegen: string;
  baseArmor: string;
  magicResistance: string;
  baseAttackDamageMin: string;
  baseAttackDamageMax: string;
  baseAttackSpeed: string;
  attackRate: string;
  attackAnimationPoint: string;
  attackRange: string;
  projectileSpeed: string;
  movementSpeed: string;
  turnRate: string;
  dayVision: string;
  nightVision: string;
  roles: HeroRoleValue[];
  localizations: HeroLocalization[];
  source: {
    sourceKey: string;
    sourceDtoSha256: string;
    inheritedFields: string[];
  };
}

export interface ParsedHeroDataset {
  heroes: CanonicalHero[];
  issues: ImportIssue[];
  counts: {
    candidateRecords: number;
    accepted: number;
    expectedExclusions: number;
    warnings: number;
    blockingErrors: number;
  };
}

export class HeroImportValidationError extends Error {
  constructor(
    message: string,
    readonly issues: ImportIssue[],
    readonly counts?: ParsedHeroDataset["counts"],
  ) {
    super(message);
    this.name = "HeroImportValidationError";
  }
}
