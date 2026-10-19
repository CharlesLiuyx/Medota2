import { effectiveAbility, modifiedValues, type TooltipAbility } from "./dota";

/** Project immutable Catalog rows after level selection, before any formatting. */
export function abilityWithTalents(
  source: TooltipAbility,
  selected: readonly string[],
): {
  ability: TooltipAbility;
  appliedTalentIds: string[];
  unresolvedTalentIds: string[];
} {
  const ids = new Set(selected);
  const applied = new Set<string>();
  const unresolved = new Set<string>();
  const ability = effectiveAbility(source);
  const values = ability.values.map((row) => {
    const modifiers =
      row.modifiers?.filter((modifier) => ids.has(modifier.key)) ?? [];
    if (!modifiers.length) return row;
    let projected: string[] | null = row.level_values.length
      ? row.level_values
      : row.scalar_value != null
        ? [row.scalar_value]
        : null;
    const seen = new Set<string>();
    for (const modifier of modifiers) {
      // Missing bases, nested conditions, or duplicate bindings remain explicit gaps.
      projected =
        projected && !seen.has(modifier.key)
          ? modifiedValues(projected, modifier.value)
          : null;
      seen.add(modifier.key);
    }
    for (const modifier of modifiers)
      (projected ? applied : unresolved).add(modifier.key);
    return { ...row, level_values: projected ?? [], scalar_value: null };
  });
  // Mirror AbilityValues overrides back to cooldown, cost, range, etc.
  return {
    ability: effectiveAbility({
      ...ability,
      source_definition: undefined,
      values,
    }),
    appliedTalentIds: [...applied],
    unresolvedTalentIds: [...unresolved],
  };
}
