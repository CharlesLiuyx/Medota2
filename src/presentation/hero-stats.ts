import {
  clampHeroLevel,
  type HeroStatModifier,
  type FlatHeroStat,
} from "@/domain/hero-build";

// Rules reviewed for the two Catalog snapshots. See attribute-catalog.md for
// pinned VPK evidence and Valve's 7.38 universal-hero damage change.
const reviewedCommits = new Set([
  "991daaf6fc24b08445209d9ce8767e145bab107e",
  "f4c45719314754567cb4ef4fe343bbc790a311f4",
]);

export const supportsHeroStats = (sourceCommit: string | null) =>
  reviewedCommits.has(sourceCommit ?? "");

export const HERO_STATS_FIELDS = [
  "internal_name",
  "primary_attribute",
  "attack_type",
  "base_strength",
  "strength_gain",
  "base_agility",
  "agility_gain",
  "base_intelligence",
  "intelligence_gain",
  "base_health",
  "base_health_regen",
  "base_mana",
  "base_mana_regen",
  "base_attack_damage_min",
  "base_attack_damage_max",
  "base_armor",
  "base_attack_speed",
  "attack_rate",
  "magic_resistance",
  "movement_speed",
  "attack_range",
  "day_vision",
  "night_vision",
  "attack_animation_point",
  "projectile_speed",
  "turn_rate",
] as const;

function numeric(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    value === "" ||
    (typeof value === "string" && !value.trim())
  )
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export {
  expressionDependencies,
  expressionText,
} from "./hero-stats-expression";
import {
  literal as n,
  operation as op,
  reference,
  type StatExpression,
} from "./hero-stats-expression";
const round = (value: StatExpression) => op("round", value);

export function heroStatsAtLevel(
  hero: Record<string, unknown>,
  requestedLevel: number,
  sourceCommit: string | null,
  modifiers: readonly HeroStatModifier[] = [],
) {
  const level = clampHeroLevel(requestedLevel);
  const supported = supportsHeroStats(sourceCommit);
  const active = supported
    ? modifiers.filter((m) => Number.isFinite(m.amount))
    : [];
  const raw = (key: string) => n(numeric(hero[key]), key);
  const flat = (stat: FlatHeroStat) =>
    n(
      active.reduce(
        (sum, m) => sum + (m.kind === "flat" && m.stat === stat ? m.amount : 0),
        0,
      ),
      `flat:${stat}`,
      "固定加成",
    );
  const percent = (
    stat: Extract<HeroStatModifier, { kind: "percent" }>["stat"],
  ) =>
    op(
      "+",
      n(1),
      op(
        "÷",
        n(
          active.reduce(
            (sum, m) =>
              sum + (m.kind === "percent" && m.stat === stat ? m.amount : 0),
            0,
          ),
          `percent:${stat}`,
          "百分比加成",
        ),
        n(100),
      ),
    );
  const withFlat = (value: StatExpression, stat: FlatHeroStat) =>
    round(op("+", value, flat(stat)));
  const withPercent = (
    value: StatExpression,
    stat: Extract<HeroStatModifier, { kind: "percent" }>["stat"],
  ) => round(op("×", value, percent(stat)));
  const attribute = (key: "strength" | "agility" | "intelligence") =>
    reference(
      key,
      round(
        op(
          "×",
          op(
            "+",
            raw(`base_${key}`),
            op(
              "×",
              level === 1 && numeric(hero[`${key}_gain`]) === null
                ? n(0)
                : raw(`${key}_gain`),
              op("−", n(level, "level"), n(1)),
            ),
            flat(key),
          ),
          key === "intelligence" ? percent("intelligence") : n(1),
        ),
      ),
    );
  const strength = attribute("strength"),
    agility = attribute("agility"),
    intelligence = attribute("intelligence");
  const add = (key: string, contribution: StatExpression, multiplier = 1) =>
    round(
      op(
        "+",
        supported ? raw(key) : n(null, key),
        op("×", contribution, n(multiplier)),
      ),
    );
  const damageAttribute =
    hero.primary_attribute === "strength"
      ? strength
      : hero.primary_attribute === "agility"
        ? agility
        : hero.primary_attribute === "intelligence"
          ? intelligence
          : hero.primary_attribute === "universal"
            ? op("×", n(0.45), op("+", strength, agility, intelligence))
            : n(null);
  const resistance = (
    stat: "magicResistance" | "evasion" | "cooldownReduction",
    initial: StatExpression,
  ) =>
    round(
      op(
        "×",
        n(100),
        op(
          "−",
          n(1),
          active
            .filter(
              (m) =>
                m.stat === stat &&
                m.kind ===
                  (stat === "cooldownReduction" ? "flat" : "resistance"),
            )
            .reduce(
              (remaining, m, index) =>
                op(
                  "×",
                  remaining,
                  op(
                    "−",
                    n(1),
                    op(
                      "÷",
                      n(m.amount, `${stat}:source:${index}`, "独立叠加加成"),
                      n(100),
                    ),
                  ),
                ),
              initial,
            ),
        ),
      ),
    );
  const health = reference(
    "health",
    withPercent(withFlat(add("base_health", strength, 22), "health"), "health"),
  );
  const baseRegen = withFlat(
    add("base_health_regen", strength, 0.1),
    "healthRegen",
  );
  const calculations = {
    strength,
    agility,
    intelligence,
    health,
    healthRegen: round(
      op(
        "×",
        op(
          "+",
          baseRegen,
          op("×", health, op("−", percent("maxHealthRegen"), n(1))),
        ),
        percent("healthRegen"),
      ),
    ),
    mana: withPercent(
      withFlat(add("base_mana", intelligence, 12), "mana"),
      "mana",
    ),
    manaRegen: withPercent(
      withFlat(add("base_mana_regen", intelligence, 0.05), "manaRegen"),
      "manaRegen",
    ),
    damageMin: withFlat(
      withPercent(
        add("base_attack_damage_min", damageAttribute),
        "baseAttackDamage",
      ),
      "attackDamage",
    ),
    damageMax: withFlat(
      withPercent(
        add("base_attack_damage_max", damageAttribute),
        "baseAttackDamage",
      ),
      "attackDamage",
    ),
    armor: withPercent(
      withFlat(add("base_armor", agility, 0.16), "armor"),
      "armor",
    ),
    attackSpeed: op(
      "clamp",
      withPercent(
        withFlat(
          withPercent(add("base_attack_speed", agility), "baseAttackSpeed"),
          "attackSpeed",
        ),
        "attackSpeed",
      ),
      n(20),
      n(700),
    ),
    magicResistance: resistance(
      "magicResistance",
      op(
        "−",
        n(1),
        op("÷", add("magic_resistance", intelligence, 0.1), n(100)),
      ),
    ),
    movementSpeed: op(
      "clamp",
      withPercent(
        withFlat(raw("movement_speed"), "movementSpeed"),
        "movementSpeed",
      ),
      n(100),
      n(550),
    ),
    attackRange: withFlat(raw("attack_range"), "attackRange"),
    dayVision: withPercent(
      withFlat(raw("day_vision"), "dayVision"),
      "dayVision",
    ),
    nightVision: withPercent(
      withFlat(raw("night_vision"), "nightVision"),
      "nightVision",
    ),
    baseAttackTime: withPercent(raw("attack_rate"), "baseAttackTime"),
    spellAmplification: flat("spellAmplification"),
    manaCostReduction: flat("manaCostReduction"),
    slowResistance: flat("slowResistance"),
    knockbackResistance: flat("knockbackResistance"),
    statusResistance: flat("statusResistance"),
    debuffAmplification: flat("debuffAmplification"),
    incomingDamage: flat("incomingDamage"),
    onHitMagicDamage: flat("onHitMagicDamage"),
    castSpeed: flat("castSpeed"),
    goldPerMinute: flat("goldPerMinute"),
    healingAmplification: flat("healingAmplification"),
    outgoingDamage: flat("outgoingDamage"),
    spellArea: flat("spellArea"),
    castRangeBonus: flat("castRangeBonus"),
    cooldownReduction: resistance("cooldownReduction", n(1)),
    lifesteal: flat("lifesteal"),
    spellLifesteal: flat("spellLifesteal"),
    evasion: resistance("evasion", n(1)),
  };
  const values = Object.fromEntries(
    Object.entries(calculations).map(([key, expression]) => [
      key,
      expression.value,
    ]),
  ) as Record<keyof typeof calculations, number | null>;
  return { level, supported, ...values, calculations };
}
export type HeroStatCalculations = ReturnType<
  typeof heroStatsAtLevel
>["calculations"];

/** Fixed-order marginal attribution after inventory uniqueness rules. No hover-time work. */
export function heroStatContributions(
  hero: Record<string, unknown>,
  level: number,
  sourceCommit: string | null,
  talents: readonly HeroStatModifier[],
  stages: readonly {
    source: import("@/domain/hero-inventory").InventoryStatSource | null;
    modifiers: readonly HeroStatModifier[];
  }[],
) {
  const snapshots = stages.map((stage) => ({
    source: stage.source,
    calculations: heroStatsAtLevel(hero, level, sourceCommit, [
      ...talents,
      ...stage.modifiers,
    ]).calculations,
  }));
  const base = snapshots[0]?.calculations;
  const sources = snapshots.slice(1).map((snapshot, index) => ({
    ...snapshot.source!,
    changes: Object.fromEntries(
      Object.entries(snapshot.calculations).flatMap(([stat, node]) => {
        const before =
          snapshots[index].calculations[
            stat as keyof typeof snapshot.calculations
          ].value;
        const after = node.value;
        if (before === null || after === null || before === after) return [];
        return [
          [
            stat,
            { before, after, amount: Number((after - before).toFixed(4)) },
          ],
        ];
      }),
    ),
  }));
  return { base, sources };
}
export type HeroStatContributions = ReturnType<typeof heroStatContributions>;
