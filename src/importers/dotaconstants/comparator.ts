import type { HeroRole } from "@/domain/heroes";

export interface CanonicalComparisonHero {
  hero_id: number;
  internal_name: string;
  primary_attribute: string;
  attack_type: string;
  roles: string[];
  base_health: string;
  base_mana: string;
  base_health_regen: string;
  base_mana_regen: string;
  base_armor: string;
  magic_resistance: string;
  base_attack_damage_min: string;
  base_attack_damage_max: string;
  base_strength: string;
  base_agility: string;
  base_intelligence: string;
  strength_gain: string;
  agility_gain: string;
  intelligence_gain: string;
  attack_range: string;
  projectile_speed: string;
  attack_rate: string;
  attack_animation_point: string;
  base_attack_speed: string;
  movement_speed: string;
  turn_rate: string;
  cm_enabled: boolean;
  day_vision: string;
  night_vision: string;
  english_name: string;
}

export interface ReferenceComparisonHero {
  hero_id: number;
  internal_name: string;
  raw_record: Record<string, unknown>;
}

export interface ReferenceDiff {
  heroId: number;
  fieldName: string;
  diffType:
    | "missing_in_reference"
    | "extra_in_reference"
    | "identity_mismatch"
    | "value_mismatch";
  canonicalValue: unknown;
  referenceValue: unknown;
}

type Normalizer = (value: unknown) => unknown;

const attr: Record<string, string> = {
  str: "strength",
  agi: "agility",
  int: "intelligence",
  all: "universal",
};
const attack: Record<string, string> = { Melee: "melee", Ranged: "ranged" };

const fields: Array<{
  reference: string;
  canonical: keyof CanonicalComparisonHero;
  normalize?: Normalizer;
  normalizeReference?: Normalizer;
}> = [
  {
    reference: "primary_attr",
    canonical: "primary_attribute",
    normalizeReference: (value) => mapString(value, attr),
  },
  {
    reference: "attack_type",
    canonical: "attack_type",
    normalizeReference: (value) => mapString(value, attack),
  },
  { reference: "roles", canonical: "roles", normalize: normalizeRoles },
  {
    reference: "base_health",
    canonical: "base_health",
    normalize: normalizeDecimal,
  },
  {
    reference: "base_mana",
    canonical: "base_mana",
    normalize: normalizeDecimal,
  },
  {
    reference: "base_health_regen",
    canonical: "base_health_regen",
    normalize: normalizeDecimal,
  },
  {
    reference: "base_mana_regen",
    canonical: "base_mana_regen",
    normalize: normalizeDecimal,
  },
  {
    reference: "base_armor",
    canonical: "base_armor",
    normalize: normalizeDecimal,
  },
  {
    reference: "base_mr",
    canonical: "magic_resistance",
    normalize: normalizeDecimal,
  },
  {
    reference: "base_attack_min",
    canonical: "base_attack_damage_min",
    normalize: normalizeDecimal,
  },
  {
    reference: "base_attack_max",
    canonical: "base_attack_damage_max",
    normalize: normalizeDecimal,
  },
  {
    reference: "base_str",
    canonical: "base_strength",
    normalize: normalizeDecimal,
  },
  {
    reference: "base_agi",
    canonical: "base_agility",
    normalize: normalizeDecimal,
  },
  {
    reference: "base_int",
    canonical: "base_intelligence",
    normalize: normalizeDecimal,
  },
  {
    reference: "str_gain",
    canonical: "strength_gain",
    normalize: normalizeDecimal,
  },
  {
    reference: "agi_gain",
    canonical: "agility_gain",
    normalize: normalizeDecimal,
  },
  {
    reference: "int_gain",
    canonical: "intelligence_gain",
    normalize: normalizeDecimal,
  },
  {
    reference: "attack_range",
    canonical: "attack_range",
    normalize: normalizeDecimal,
  },
  {
    reference: "projectile_speed",
    canonical: "projectile_speed",
    normalize: normalizeDecimal,
  },
  {
    reference: "attack_rate",
    canonical: "attack_rate",
    normalize: normalizeDecimal,
  },
  {
    reference: "attack_point",
    canonical: "attack_animation_point",
    normalize: normalizeDecimal,
  },
  {
    reference: "base_attack_time",
    canonical: "base_attack_speed",
    normalize: normalizeDecimal,
  },
  {
    reference: "move_speed",
    canonical: "movement_speed",
    normalize: normalizeDecimal,
  },
  {
    reference: "turn_rate",
    canonical: "turn_rate",
    normalize: normalizeDecimal,
  },
  { reference: "cm_enabled", canonical: "cm_enabled" },
  {
    reference: "day_vision",
    canonical: "day_vision",
    normalize: normalizeDecimal,
  },
  {
    reference: "night_vision",
    canonical: "night_vision",
    normalize: normalizeDecimal,
  },
  { reference: "localized_name", canonical: "english_name" },
];

export function compareReferenceHeroes(
  canonicalHeroes: CanonicalComparisonHero[],
  referenceHeroes: ReferenceComparisonHero[],
): { diffs: ReferenceDiff[]; matchedCount: number } {
  const canonicalById = new Map(
    canonicalHeroes.map((hero) => [hero.hero_id, hero]),
  );
  const referenceById = new Map(
    referenceHeroes.map((hero) => [hero.hero_id, hero]),
  );
  const diffs: ReferenceDiff[] = [];
  let matchedCount = 0;

  for (const canonical of canonicalHeroes) {
    const reference = referenceById.get(canonical.hero_id);
    if (!reference) {
      diffs.push({
        heroId: canonical.hero_id,
        fieldName: "record",
        diffType: "missing_in_reference",
        canonicalValue: canonical.internal_name,
        referenceValue: null,
      });
      continue;
    }
    matchedCount += 1;
    if (reference.internal_name !== canonical.internal_name) {
      diffs.push({
        heroId: canonical.hero_id,
        fieldName: "internal_name",
        diffType: "identity_mismatch",
        canonicalValue: canonical.internal_name,
        referenceValue: reference.internal_name,
      });
    }
    for (const field of fields) {
      const canonicalValue = (field.normalize ?? identity)(
        canonical[field.canonical],
      );
      const referenceValue = (
        field.normalizeReference ??
        field.normalize ??
        identity
      )(reference.raw_record[field.reference]);
      if (!deepEqual(canonicalValue, referenceValue)) {
        diffs.push({
          heroId: canonical.hero_id,
          fieldName: String(field.canonical),
          diffType: "value_mismatch",
          canonicalValue,
          referenceValue,
        });
      }
    }
  }

  for (const reference of referenceHeroes) {
    if (!canonicalById.has(reference.hero_id)) {
      diffs.push({
        heroId: reference.hero_id,
        fieldName: "record",
        diffType: "extra_in_reference",
        canonicalValue: null,
        referenceValue: reference.internal_name,
      });
    }
  }
  return { diffs, matchedCount };
}

export function normalizeDecimal(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" && typeof value !== "string")
    return `invalid:${typeof value}`;
  const text = String(value);
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(text)) return `invalid:${text}`;
  const negative = text.startsWith("-");
  const [integerRaw, fractionRaw = ""] = text.replace(/^-/, "").split(".");
  const integer = integerRaw.replace(/^0+(?=\d)/u, "");
  const fraction = fractionRaw.replace(/0+$/u, "");
  const result = fraction ? `${integer}.${fraction}` : integer;
  return negative && result !== "0" ? `-${result}` : result;
}

function normalizeRoles(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((role) => typeof role !== "string"))
    return null;
  return [
    ...new Set(
      value.map((role) => (role as string).trim().toLowerCase() as HeroRole),
    ),
  ].sort();
}

function mapString(
  value: unknown,
  mapping: Record<string, string>,
): string | null {
  return typeof value === "string"
    ? (mapping[value] ?? `invalid:${value}`)
    : null;
}

function identity(value: unknown): unknown {
  return value === undefined ? null : value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
