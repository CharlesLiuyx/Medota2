import {
  ATTACK_TYPES,
  FACTIONS,
  HERO_LOCALES,
  HERO_ROLES,
  HeroImportValidationError,
  type AttackType,
  type CanonicalHero,
  type Faction,
  type HeroLocale,
  type HeroLocalization,
  type HeroRole,
  type ImportIssue,
  type ParsedHeroDataset,
  type PrimaryAttribute,
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
import { HERO_DENYLIST } from "./constants";

const HEROES_PATH = "scripts/npc/npc_heroes.txt";
const HERO_NAME = /^npc_dota_hero_[a-z0-9_]+$/u;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

const SOURCE_SCALAR_KEYS = [
  "HeroID",
  "Enabled",
  "CMEnabled",
  "RandomEnabled",
  "AttributePrimary",
  "AttackCapabilities",
  "Team",
  "Complexity",
  "AttributeBaseStrength",
  "AttributeStrengthGain",
  "AttributeBaseAgility",
  "AttributeAgilityGain",
  "AttributeBaseIntelligence",
  "AttributeIntelligenceGain",
  "StatusHealth",
  "StatusMana",
  "StatusHealthRegen",
  "StatusManaRegen",
  "ArmorPhysical",
  "MagicalResistance",
  "AttackDamageMin",
  "AttackDamageMax",
  "BaseAttackSpeed",
  "AttackRate",
  "AttackAnimationPoint",
  "AttackRange",
  "ProjectileSpeed",
  "MovementSpeed",
  "MovementTurnRate",
  "VisionDaytimeRange",
  "VisionNighttimeRange",
] as const;

const ROLE_KEYS = ["Role", "Rolelevels"] as const;
type SourceScalarKey =
  (typeof SOURCE_SCALAR_KEYS)[number] | (typeof ROLE_KEYS)[number];

const PRIMARY_ATTRIBUTE_MAP: Record<string, PrimaryAttribute> = {
  DOTA_ATTRIBUTE_STRENGTH: "strength",
  DOTA_ATTRIBUTE_AGILITY: "agility",
  DOTA_ATTRIBUTE_INTELLECT: "intelligence",
  DOTA_ATTRIBUTE_ALL: "universal",
};

const ATTACK_TYPE_MAP: Record<string, AttackType> = {
  DOTA_UNIT_CAP_MELEE_ATTACK: "melee",
  DOTA_UNIT_CAP_RANGED_ATTACK: "ranged",
};

interface SourceDto {
  values: Partial<Record<SourceScalarKey, string>>;
  inheritedFields: string[];
}

interface LocalizationFiles {
  abilities: TokenIndex;
  hype: TokenIndex;
  lore: TokenIndex;
  abilitiesPath: string;
  hypePath: string;
  lorePath: string;
}

type TokenIndex = Map<string, KeyValuesEntry[]>;

export function parseHeroDataset(
  files: readonly CheckedSourceFile[],
): ParsedHeroDataset {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const heroFile = requiredFile(byPath, HEROES_PATH);
  const root = uniqueObject(parseKeyValues(heroFile.text), "DOTAHeroes");
  const issues: ImportIssue[] = [];

  const baseEntries = objectEntries(root, "npc_dota_hero_base");
  if (baseEntries.length !== 1 || typeof baseEntries[0].value === "string") {
    throw validationError(
      "npc_dota_hero_base must appear exactly once as an object.",
      [
        blocking(
          "invalid_base",
          "npc_dota_hero_base must appear exactly once as an object.",
          {
            sourcePath: HEROES_PATH,
          },
        ),
      ],
    );
  }
  const base = scalarValues(baseEntries[0].value, "npc_dota_hero_base", issues);
  const locales = new Map<HeroLocale, LocalizationFiles>(
    HERO_LOCALES.map((locale) => [
      locale,
      readLocalizationFiles(byPath, locale),
    ]),
  );

  const heroes: CanonicalHero[] = [];
  let candidateRecords = 0;
  let expectedExclusions = 0;

  for (const entry of root.entries) {
    if (!entry.key.startsWith("npc_dota_hero_")) continue;
    candidateRecords += 1;
    if (typeof entry.value === "string") {
      issues.push(
        blocking(
          "hero_not_object",
          `${entry.key} must be a KeyValues object.`,
          { sourceKey: entry.key },
        ),
      );
      continue;
    }

    const own = scalarValues(entry.value, entry.key, issues);
    const dto = inheritSourceDto(own, base);
    const enabled = dto.values.Enabled;
    if (HERO_DENYLIST.has(entry.key)) {
      issues.push({
        severity: "expected_exclusion",
        code: "denylisted_hero",
        message: `${entry.key} is excluded by the versioned MVP denylist.`,
        sourceKey: entry.key,
      });
      expectedExclusions += 1;
      continue;
    }
    if (enabled !== "1") {
      issues.push({
        severity: "expected_exclusion",
        code: "disabled_hero",
        message: `${entry.key} has Enabled != 1.`,
        sourceKey: entry.key,
      });
      expectedExclusions += 1;
      continue;
    }
    if (!HERO_NAME.test(entry.key)) {
      issues.push(
        blocking(
          "invalid_internal_name",
          `Enabled hero has an invalid internal name: ${entry.key}.`,
          { sourceKey: entry.key },
        ),
      );
      continue;
    }

    const hero = mapHero(entry.key, dto, locales, issues);
    if (hero) heroes.push(hero);
  }

  validateUniqueness(heroes, issues);
  heroes.sort((a, b) => a.heroId - b.heroId);

  const counts = {
    candidateRecords,
    accepted: heroes.length,
    expectedExclusions,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
    blockingErrors: issues.filter((issue) => issue.severity === "blocking")
      .length,
  };
  if (counts.blockingErrors > 0) {
    throw new HeroImportValidationError(
      `Hero dataset has ${counts.blockingErrors} blocking validation error(s).`,
      issues,
      counts,
    );
  }

  return { heroes, issues, counts };
}

function scalarValues(
  object: KeyValuesObject,
  sourceKey: string,
  issues: ImportIssue[],
): Partial<Record<SourceScalarKey, string>> {
  const result: Partial<Record<SourceScalarKey, string>> = {};
  for (const key of [...SOURCE_SCALAR_KEYS, ...ROLE_KEYS]) {
    const entries = objectEntries(object, key);
    if (entries.length > 1) {
      issues.push(
        blocking(
          "duplicate_allowlist_key",
          `${sourceKey} contains duplicate ${key} keys.`,
          {
            sourceKey,
            sourcePath: HEROES_PATH,
          },
        ),
      );
      continue;
    }
    if (entries.length === 1) {
      if (typeof entries[0].value !== "string") {
        issues.push(
          blocking(
            "non_scalar_allowlist_key",
            `${sourceKey}.${key} must be a scalar string.`,
            { sourceKey },
          ),
        );
      } else {
        result[key] = entries[0].value;
      }
    }
  }
  return result;
}

function inheritSourceDto(
  own: Partial<Record<SourceScalarKey, string>>,
  base: Partial<Record<SourceScalarKey, string>>,
): SourceDto {
  const values: SourceDto["values"] = {};
  const inheritedFields: string[] = [];
  for (const key of SOURCE_SCALAR_KEYS) {
    if (Object.hasOwn(own, key)) values[key] = own[key];
    else if (Object.hasOwn(base, key)) {
      values[key] = base[key];
      inheritedFields.push(key);
    }
  }
  for (const key of ROLE_KEYS) {
    if (Object.hasOwn(own, key)) values[key] = own[key];
  }
  return { values, inheritedFields: inheritedFields.sort() };
}

function mapHero(
  internalName: string,
  dto: SourceDto,
  locales: Map<HeroLocale, LocalizationFiles>,
  issues: ImportIssue[],
): CanonicalHero | null {
  const beforeErrors = countBlocking(issues);
  const heroId = positiveInteger(
    dto.values.HeroID,
    "HeroID",
    internalName,
    issues,
  );
  const complexity = rangedInteger(
    dto.values.Complexity,
    "Complexity",
    internalName,
    1,
    3,
    issues,
  );
  const cmEnabled = strictBoolean(
    dto.values.CMEnabled,
    "CMEnabled",
    internalName,
    issues,
  );
  const randomEnabled =
    dto.values.RandomEnabled === undefined
      ? null
      : strictBoolean(
          dto.values.RandomEnabled,
          "RandomEnabled",
          internalName,
          issues,
        );
  const primaryAttribute = mappedEnum(
    dto.values.AttributePrimary,
    "AttributePrimary",
    PRIMARY_ATTRIBUTE_MAP,
    internalName,
    issues,
  );
  const attackType = mappedEnum(
    dto.values.AttackCapabilities,
    "AttackCapabilities",
    ATTACK_TYPE_MAP,
    internalName,
    issues,
  );
  const faction = mapFaction(dto.values.Team, internalName, issues);
  const roles = mapRoles(
    dto.values.Role,
    dto.values.Rolelevels,
    internalName,
    issues,
  );

  const decimalFields = {
    baseStrength: decimal(
      dto.values.AttributeBaseStrength,
      "AttributeBaseStrength",
      internalName,
      issues,
    ),
    strengthGain: decimal(
      dto.values.AttributeStrengthGain,
      "AttributeStrengthGain",
      internalName,
      issues,
    ),
    baseAgility: decimal(
      dto.values.AttributeBaseAgility,
      "AttributeBaseAgility",
      internalName,
      issues,
    ),
    agilityGain: decimal(
      dto.values.AttributeAgilityGain,
      "AttributeAgilityGain",
      internalName,
      issues,
    ),
    baseIntelligence: decimal(
      dto.values.AttributeBaseIntelligence,
      "AttributeBaseIntelligence",
      internalName,
      issues,
    ),
    intelligenceGain: decimal(
      dto.values.AttributeIntelligenceGain,
      "AttributeIntelligenceGain",
      internalName,
      issues,
    ),
    baseHealth: decimal(
      dto.values.StatusHealth,
      "StatusHealth",
      internalName,
      issues,
    ),
    baseMana: decimal(
      dto.values.StatusMana,
      "StatusMana",
      internalName,
      issues,
    ),
    baseHealthRegen: decimal(
      dto.values.StatusHealthRegen,
      "StatusHealthRegen",
      internalName,
      issues,
    ),
    baseManaRegen: decimal(
      dto.values.StatusManaRegen,
      "StatusManaRegen",
      internalName,
      issues,
    ),
    baseArmor: decimal(
      dto.values.ArmorPhysical,
      "ArmorPhysical",
      internalName,
      issues,
    ),
    magicResistance: decimal(
      dto.values.MagicalResistance,
      "MagicalResistance",
      internalName,
      issues,
    ),
    baseAttackDamageMin: decimal(
      dto.values.AttackDamageMin,
      "AttackDamageMin",
      internalName,
      issues,
    ),
    baseAttackDamageMax: decimal(
      dto.values.AttackDamageMax,
      "AttackDamageMax",
      internalName,
      issues,
    ),
    baseAttackSpeed: decimal(
      dto.values.BaseAttackSpeed,
      "BaseAttackSpeed",
      internalName,
      issues,
    ),
    attackRate: decimal(
      dto.values.AttackRate,
      "AttackRate",
      internalName,
      issues,
    ),
    attackAnimationPoint: decimal(
      dto.values.AttackAnimationPoint,
      "AttackAnimationPoint",
      internalName,
      issues,
    ),
    attackRange: decimal(
      dto.values.AttackRange,
      "AttackRange",
      internalName,
      issues,
    ),
    projectileSpeed: decimal(
      dto.values.ProjectileSpeed,
      "ProjectileSpeed",
      internalName,
      issues,
    ),
    movementSpeed: decimal(
      dto.values.MovementSpeed,
      "MovementSpeed",
      internalName,
      issues,
    ),
    turnRate: decimal(
      dto.values.MovementTurnRate,
      "MovementTurnRate",
      internalName,
      issues,
    ),
    dayVision: decimal(
      dto.values.VisionDaytimeRange,
      "VisionDaytimeRange",
      internalName,
      issues,
    ),
    nightVision: decimal(
      dto.values.VisionNighttimeRange,
      "VisionNighttimeRange",
      internalName,
      issues,
    ),
  };

  if (
    decimalFields.baseAttackDamageMin &&
    decimalFields.baseAttackDamageMax &&
    compareDecimals(
      decimalFields.baseAttackDamageMax,
      decimalFields.baseAttackDamageMin,
    ) < 0
  ) {
    issues.push(
      blocking(
        "invalid_damage_range",
        `${internalName} AttackDamageMax is less than AttackDamageMin.`,
        { sourceKey: internalName },
      ),
    );
  }

  const localizations = heroId
    ? mapLocalizations(internalName, heroId, locales, issues)
    : [];
  if (countBlocking(issues) > beforeErrors) return null;

  const sourceDto = { internal_name: internalName, ...dto.values };
  return {
    heroId: heroId!,
    internalName,
    slug: internalName.slice("npc_dota_hero_".length),
    enabled: true,
    cmEnabled: cmEnabled!,
    randomEnabled,
    primaryAttribute: primaryAttribute!,
    attackType: attackType!,
    faction: faction!,
    complexity: complexity!,
    ...Object.fromEntries(
      Object.entries(decimalFields).map(([key, value]) => [key, value!]),
    ),
    roles,
    localizations,
    source: {
      sourceKey: internalName,
      sourceDtoSha256: canonicalJsonSha256(sourceDto),
      inheritedFields: dto.inheritedFields,
    },
  } as CanonicalHero;
}

function readLocalizationFiles(
  byPath: Map<string, CheckedSourceFile>,
  locale: HeroLocale,
): LocalizationFiles {
  const fileLocale = locale === "en" ? "english" : "schinese";
  const abilitiesPath = `resource/localization/abilities_${fileLocale}.txt`;
  const hypePath = `resource/localization/dota_${fileLocale}.txt`;
  const lorePath = `resource/localization/hero_lore_${fileLocale}.txt`;
  return {
    abilities: tokenIndex(requiredFile(byPath, abilitiesPath).text),
    hype: tokenIndex(requiredFile(byPath, hypePath).text),
    lore: tokenIndex(requiredFile(byPath, lorePath).text),
    abilitiesPath,
    hypePath,
    lorePath,
  };
}

function tokenIndex(source: string): TokenIndex {
  const lang = uniqueObject(parseKeyValues(source), "lang");
  const tokens = uniqueObject(lang, "Tokens");
  const index: TokenIndex = new Map();
  for (const entry of tokens.entries) {
    const values = index.get(entry.key) ?? [];
    values.push(entry);
    index.set(entry.key, values);
  }
  return index;
}

function mapLocalizations(
  internalName: string,
  heroId: number,
  localeFiles: Map<HeroLocale, LocalizationFiles>,
  issues: ImportIssue[],
): HeroLocalization[] {
  return HERO_LOCALES.map((locale) => {
    const files = localeFiles.get(locale)!;
    const nameToken = `${internalName}:n`;
    const variantToken = `${internalName}__en:n`;
    const hypeToken = `${internalName}_hype`;
    const loreToken = `${internalName}_bio`;
    const displayName = localizedValue(
      files.abilities,
      nameToken,
      true,
      files.abilitiesPath,
      internalName,
      heroId,
      issues,
    );
    const englishNameVariant = localizedValue(
      files.abilities,
      variantToken,
      false,
      files.abilitiesPath,
      internalName,
      heroId,
      issues,
    );
    const hype = localizedValue(
      files.hype,
      hypeToken,
      false,
      files.hypePath,
      internalName,
      heroId,
      issues,
      true,
    );
    const lore = localizedValue(
      files.lore,
      loreToken,
      false,
      files.lorePath,
      internalName,
      heroId,
      issues,
      true,
    );
    return {
      locale,
      displayName: displayName ?? "",
      englishNameVariant,
      hype,
      lore,
      nameSourcePath: files.abilitiesPath,
      nameToken,
      englishNameVariantToken:
        englishNameVariant === null ? null : variantToken,
      hypeSourcePath: hype === null ? null : files.hypePath,
      hypeToken: hype === null ? null : hypeToken,
      loreSourcePath: lore === null ? null : files.lorePath,
      loreToken: lore === null ? null : loreToken,
    };
  });
}

function localizedValue(
  index: TokenIndex,
  token: string,
  required: boolean,
  sourcePath: string,
  sourceKey: string,
  heroId: number,
  issues: ImportIssue[],
  warnIfMissing = false,
): string | null {
  const matches = index.get(token) ?? [];
  if (matches.length > 1) {
    issues.push(
      blocking(
        "duplicate_localization_token",
        `${sourcePath} contains duplicate token ${token}.`,
        { sourceKey, sourcePath, token },
      ),
    );
    return null;
  }
  if (
    matches.length === 0 ||
    typeof matches[0].value !== "string" ||
    matches[0].value === ""
  ) {
    if (required) {
      issues.push(
        blocking(
          "missing_localized_name",
          `${sourceKey} is missing required localized name ${token}.`,
          {
            heroId,
            sourceKey,
            sourcePath,
            token,
          },
        ),
      );
    } else if (warnIfMissing) {
      issues.push({
        severity: "warning",
        code: "missing_optional_localization",
        message: `${sourceKey} does not provide optional token ${token}.`,
        heroId,
        sourceKey,
        sourcePath,
        token,
      });
    }
    return null;
  }
  return matches[0].value;
}

function mapRoles(
  roleValue: string | undefined,
  levelValue: string | undefined,
  sourceKey: string,
  issues: ImportIssue[],
): CanonicalHero["roles"] {
  if (
    roleValue === undefined ||
    levelValue === undefined ||
    roleValue === "" ||
    levelValue === ""
  ) {
    issues.push(
      blocking(
        "missing_roles",
        `${sourceKey} must provide non-empty Role and Rolelevels.`,
        { sourceKey },
      ),
    );
    return [];
  }
  const roles = roleValue.split(",").map((value) => value.trim().toLowerCase());
  const levels = levelValue.split(",").map((value) => value.trim());
  if (
    roles.some((role) => role === "") ||
    levels.some((level) => level === "") ||
    roles.length !== levels.length
  ) {
    issues.push(
      blocking(
        "misaligned_roles",
        `${sourceKey} Role and Rolelevels must have equal non-empty entries.`,
        { sourceKey },
      ),
    );
    return [];
  }
  if (new Set(roles).size !== roles.length) {
    issues.push(
      blocking("duplicate_role", `${sourceKey} contains a duplicate role.`, {
        sourceKey,
      }),
    );
    return [];
  }

  return roles.flatMap((role, index) => {
    if (!(HERO_ROLES as readonly string[]).includes(role)) {
      issues.push(
        blocking(
          "unknown_role",
          `${sourceKey} contains unknown role ${role}.`,
          { sourceKey },
        ),
      );
      return [];
    }
    if (!/^[1-3]$/u.test(levels[index])) {
      issues.push(
        blocking(
          "invalid_role_level",
          `${sourceKey} contains invalid role level ${levels[index]}.`,
          { sourceKey },
        ),
      );
      return [];
    }
    return [{ role: role as HeroRole, level: Number(levels[index]) }];
  });
}

function positiveInteger(
  value: string | undefined,
  key: string,
  sourceKey: string,
  issues: ImportIssue[],
): number | null {
  if (!value || !/^[1-9]\d*$/u.test(value)) {
    issues.push(
      blocking(
        "invalid_positive_integer",
        `${sourceKey}.${key} must be a positive integer.`,
        { sourceKey },
      ),
    );
    return null;
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    issues.push(
      blocking(
        "unsafe_integer",
        `${sourceKey}.${key} exceeds the safe integer range.`,
        { sourceKey },
      ),
    );
    return null;
  }
  return number;
}

function rangedInteger(
  value: string | undefined,
  key: string,
  sourceKey: string,
  min: number,
  max: number,
  issues: ImportIssue[],
): number | null {
  if (
    !value ||
    !/^\d+$/u.test(value) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    issues.push(
      blocking(
        "invalid_ranged_integer",
        `${sourceKey}.${key} must be an integer from ${min} to ${max}.`,
        { sourceKey },
      ),
    );
    return null;
  }
  return Number(value);
}

function strictBoolean(
  value: string | undefined,
  key: string,
  sourceKey: string,
  issues: ImportIssue[],
): boolean | null {
  if (value === "0") return false;
  if (value === "1") return true;
  issues.push(
    blocking("invalid_boolean", `${sourceKey}.${key} must be 0 or 1.`, {
      sourceKey,
    }),
  );
  return null;
}

function mappedEnum<T extends string>(
  value: string | undefined,
  key: string,
  mapping: Record<string, T>,
  sourceKey: string,
  issues: ImportIssue[],
): T | null {
  const mapped = value ? mapping[value] : undefined;
  if (!mapped) {
    issues.push(
      blocking(
        "unknown_enum",
        `${sourceKey}.${key} has unsupported value ${value ?? "<missing>"}.`,
        { sourceKey },
      ),
    );
    return null;
  }
  return mapped;
}

function mapFaction(
  value: string | undefined,
  sourceKey: string,
  issues: ImportIssue[],
): Faction | null {
  const normalized = value?.toLowerCase();
  const faction =
    normalized === "good" ? "radiant" : normalized === "bad" ? "dire" : null;
  if (!faction || !(FACTIONS as readonly string[]).includes(faction)) {
    issues.push(
      blocking(
        "unknown_faction",
        `${sourceKey}.Team has unsupported value ${value ?? "<missing>"}.`,
        { sourceKey },
      ),
    );
  }
  return faction;
}

function decimal(
  value: string | undefined,
  key: string,
  sourceKey: string,
  issues: ImportIssue[],
): string | null {
  if (!value || !DECIMAL.test(value)) {
    issues.push(
      blocking(
        "invalid_decimal",
        `${sourceKey}.${key} must be a decimal string.`,
        { sourceKey },
      ),
    );
    return null;
  }
  const [integer] = value.replace(/^-/, "").split(".");
  if (integer.length > 6) {
    issues.push(
      blocking(
        "decimal_out_of_range",
        `${sourceKey}.${key} does not fit numeric(12,6).`,
        { sourceKey },
      ),
    );
    return null;
  }
  return value;
}

export function compareDecimals(left: string, right: string): number {
  const normalize = (value: string) => {
    const negative = value.startsWith("-");
    const [integer, fraction = ""] = value.replace(/^-/, "").split(".");
    return {
      negative,
      magnitude: BigInt(`${integer}${fraction.padEnd(6, "0")}`),
    };
  };
  const a = normalize(left);
  const b = normalize(right);
  const signedA = a.negative ? -a.magnitude : a.magnitude;
  const signedB = b.negative ? -b.magnitude : b.magnitude;
  return signedA < signedB ? -1 : signedA > signedB ? 1 : 0;
}

function validateUniqueness(
  heroes: CanonicalHero[],
  issues: ImportIssue[],
): void {
  for (const [label, value] of [
    ["HeroID", (hero: CanonicalHero) => String(hero.heroId)],
    ["internal name", (hero: CanonicalHero) => hero.internalName],
    ["slug", (hero: CanonicalHero) => hero.slug],
  ] as const) {
    const seen = new Set<string>();
    for (const hero of heroes) {
      const key = value(hero);
      if (seen.has(key)) {
        issues.push(
          blocking("duplicate_identity", `Duplicate ${label}: ${key}.`, {
            heroId: hero.heroId,
            sourceKey: hero.internalName,
          }),
        );
      }
      seen.add(key);
    }
  }
}

function requiredFile(
  byPath: Map<string, CheckedSourceFile>,
  path: string,
): CheckedSourceFile {
  const file = byPath.get(path);
  if (!file)
    throw new Error(`Required checked source file was not provided: ${path}`);
  return file;
}

function blocking(
  code: string,
  message: string,
  details: Omit<ImportIssue, "severity" | "code" | "message"> = {},
): ImportIssue {
  return { severity: "blocking", code, message, ...details };
}

function countBlocking(issues: ImportIssue[]): number {
  return issues.filter((issue) => issue.severity === "blocking").length;
}

function validationError(
  message: string,
  issues: ImportIssue[],
): HeroImportValidationError {
  return new HeroImportValidationError(message, issues);
}

// Keep exported enum constants referenced by this module visible to static analysis.
void ATTACK_TYPES;
