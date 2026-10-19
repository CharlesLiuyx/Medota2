import { effectiveAbility, type TooltipAbility } from "./dota";

const levelFields = [
  "cooldown",
  "mana_cost",
  "cast_range",
  "cast_point",
  "channel_time",
  "damage",
  "duration",
  "health_cost",
  "charges",
  "charge_restore_time",
] as const;

function values(input: unknown): string[] {
  if (input == null) return [];
  const parts = Array.isArray(input)
    ? input.map(String)
    : String(input).trim().split(/\s+/u);
  return parts.every((part) => /^[+-]?(?:\d+\.?\d*|\.\d+)%?$/u.test(part))
    ? parts
    : [];
}

/** Explicit catalog limits win; absent limits use the levels actually present. */
export function abilityMaxLevel(source: TooltipAbility): number | null {
  const explicit = Number(source.max_level);
  if (Number.isInteger(explicit) && explicit > 0) return explicit;
  if (source.definition_kind === "talent") return 1;
  const ability = effectiveAbility(source);
  const count = Math.max(
    0,
    ...levelFields.map((key) => {
      const parts = values(ability[key]);
      return parts.some((part) => Number(part.replace("%", "")) !== 0)
        ? parts.length
        : 0;
    }),
    ...ability.values.map((row) => row.level_values.length),
  );
  return count > 1 ? count : null;
}

/** Select before formatting, including Aghanim modifiers, to keep all text consistent. */
export function abilityAtLevel(
  source: TooltipAbility,
  level: number,
): TooltipAbility {
  const ability = effectiveAbility(source);
  const select = (input: unknown) => {
    const parts = values(input);
    return parts.length ? parts[Math.min(level - 1, parts.length - 1)] : input;
  };
  const result: TooltipAbility = { ...ability, source_definition: undefined };
  for (const key of levelFields) result[key] = select(ability[key]);
  result.values = ability.values.map((row) => ({
    ...row,
    level_values: row.level_values.length
      ? [String(select(row.level_values))]
      : [],
    modifiers: row.modifiers?.map((modifier) => {
      if (typeof modifier.value !== "string") return modifier;
      const parts = modifier.value.trim().split(/\s+/u);
      if (
        !parts.every((part) =>
          /^[+*=x]?[+-]?(?:\d+\.?\d*|\.\d+)%?$/u.test(part),
        )
      )
        return modifier;
      return {
        ...modifier,
        value: parts[Math.min(level - 1, parts.length - 1)],
      };
    }),
  }));
  return result;
}

/** Learning metadata is read from the same resolved Catalog definition as values. */
export function abilitySourceField(
  ability: TooltipAbility,
  key: string,
): string | undefined {
  const source = ability.source_definition as
    { entries?: Array<{ key: string; value: unknown }> } | undefined;
  const value = source?.entries?.find((entry) => entry.key === key)?.value;
  return typeof value === "string" ? value : undefined;
}

export function heroAbilityRules(
  abilities: readonly TooltipAbility[],
): import("@/domain/hero-abilities").HeroAbilityRule[] {
  const rules = abilities.map((ability) => {
    const innate = Boolean(ability.is_innate);
    const dependentOn = abilitySourceField(ability, "DependentOnAbility");
    const fixed =
      String(ability.behavior).includes("NOT_LEARNABLE") ||
      Boolean(ability.is_granted_by_scepter || ability.is_granted_by_shard);
    return {
      id: ability.internal_name,
      group: ability.internal_name,
      maxLevel: abilityMaxLevel(ability) ?? 1,
      requiredLevel:
        Number(abilitySourceField(ability, "RequiredLevel")) ||
        (ability.is_ultimate && !innate ? 6 : 1),
      interval:
        Number(abilitySourceField(ability, "LevelsBetweenUpgrades")) ||
        (ability.is_ultimate && !innate ? 6 : 2),
      freeLevel: innate || (fixed && !dependentOn) ? 1 : 0,
      fixed,
      dependentOn,
      upgrade: ability.is_granted_by_scepter
        ? ("scepter" as const)
        : ability.is_granted_by_shard
          ? ("shard" as const)
          : undefined,
    };
  });
  // Linked variants (e.g. Shadowraze) share one rank and spend points once.
  for (const ability of abilities) {
    const linked = abilitySourceField(ability, "LinkedAbility");
    const a = rules.find((r) => r.id === ability.internal_name);
    const b = rules.find((r) => r.id === linked);
    if (!a || !b || a.dependentOn || b.dependentOn || a.maxLevel !== b.maxLevel)
      continue;
    const from = b.group,
      to = a.group;
    for (const rule of rules) if (rule.group === from) rule.group = to;
  }
  return rules;
}
