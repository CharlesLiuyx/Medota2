import type { HeroStatModifier } from "@/domain/hero-build";
import type {
  HeroAbilityBuildState,
  HeroAbilityRule,
} from "@/domain/hero-abilities";
import { heroAbilityLevel } from "@/domain/hero-abilities";
import { abilityAtLevel } from "./ability-levels";
import { abilityWithTalents } from "./ability-talents";
import { abilityWithUpgrades, type HeroUpgrades } from "./ability-upgrades";
import { supportsHeroStats } from "./hero-stats";
import type { TooltipAbility } from "./dota";

// Reviewed permanent self bonuses. Active buffs, stacks, targets and facets
// require combat state and must never be inferred from a parameter's label.
const effects: Record<
  string,
  Record<string, Omit<HeroStatModifier, "amount">>
> = {
  antimage_counterspell: {
    magic_resistance: { kind: "resistance", stat: "magicResistance" },
  },
  tiny_grow: {
    bonus_armor: { kind: "flat", stat: "armor" },
    bonus_damage: { kind: "flat", stat: "attackDamage" },
    attack_speed_reduction: { kind: "flat", stat: "attackSpeed" },
    move_speed: { kind: "flat", stat: "movementSpeed" },
  },
};
export function projectHeroAbilityStats(
  abilities: readonly TooltipAbility[],
  rules: readonly HeroAbilityRule[],
  build: HeroAbilityBuildState,
  upgrades: HeroUpgrades,
  sourceCommit: string | null,
) {
  const modifiers: HeroStatModifier[] = [];
  const applied: string[] = [];
  const unsupported: string[] = [];
  for (const source of abilities) {
    const rule = rules.find((r) => r.id === source.internal_name);
    const level = rule ? heroAbilityLevel(build, rule, rules, upgrades) : 0;
    if (!level) continue;
    const fields = effects[source.internal_name];
    if (!fields || !supportsHeroStats(sourceCommit)) {
      if (source.is_passive || fields) unsupported.push(source.internal_name);
      continue;
    }
    const ability = abilityWithTalents(
      abilityWithUpgrades(abilityAtLevel(source, level), upgrades).ability,
      build.selectedTalents,
    ).ability;
    let complete = true;
    for (const [key, effect] of Object.entries(fields)) {
      const row = ability.values.find((v) => v.value_key === key);
      const raw = row?.level_values[0] ?? row?.scalar_value;
      const amount =
        raw != null && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)
          ? Number(raw)
          : NaN;
      if (!Number.isFinite(amount)) {
        complete = false;
        continue;
      }
      modifiers.push({ ...effect, amount } as HeroStatModifier);
    }
    (complete ? applied : unsupported).push(source.internal_name);
  }
  return { modifiers, applied, unsupported };
}
