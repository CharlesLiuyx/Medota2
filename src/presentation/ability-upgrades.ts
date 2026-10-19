import { effectiveAbility, modifiedValues, type TooltipAbility } from "./dota";

export type HeroUpgrades = { scepter: boolean; shard: boolean };
/** Upgrade-specific values may omit a base: Valve's special-only fields start at 0. */
export function abilityWithUpgrades(
  source: TooltipAbility,
  upgrades: HeroUpgrades,
): {
  ability: TooltipAbility;
  applied: Array<"scepter" | "shard">;
  unresolved: string[];
  required: "scepter" | "shard" | null;
} {
  const ability = effectiveAbility(source);
  const applied = new Set<"scepter" | "shard">();
  const unresolved: string[] = [];
  const values = ability.values.map((row) => {
    let projected = row.level_values.length
      ? row.level_values
      : [row.scalar_value ?? "0"];
    let changed = false;
    for (const kind of ["scepter", "shard"] as const) {
      if (!upgrades[kind]) continue;
      const modifiers =
        row.modifiers?.filter(
          (modifier) => modifier.key === `special_bonus_${kind}`,
        ) ?? [];
      if (!modifiers.length) continue;
      const next =
        modifiers.length === 1
          ? modifiedValues(projected, modifiers[0].value)
          : null;
      if (!next) {
        unresolved.push(row.value_key);
        projected = [];
      } else {
        projected = next;
        applied.add(kind);
      }
      changed = true;
    }
    return changed
      ? { ...row, level_values: projected, scalar_value: null }
      : row;
  });
  return {
    ability: effectiveAbility({
      ...ability,
      source_definition: undefined,
      values,
    }),
    applied: [...applied],
    unresolved,
    required: ability.is_granted_by_scepter
      ? ("scepter" as const)
      : ability.is_granted_by_shard
        ? ("shard" as const)
        : null,
  };
}
