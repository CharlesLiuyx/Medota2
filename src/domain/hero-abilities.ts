import {
  clampHeroLevel,
  normalizeHeroBuild,
  updateHeroBuild,
  secondTalentLevel,
  type HeroBuildState,
  type HeroBuildAction,
  type HeroTalent,
} from "./hero-build";

export interface HeroAbilityRule {
  id: string;
  group: string;
  maxLevel: number;
  requiredLevel: number;
  interval: number;
  freeLevel: number;
  fixed: boolean;
  dependentOn?: string;
  upgrade?: "scepter" | "shard";
}
export interface HeroAbilityBuildState extends HeroBuildState {
  abilityLevels: Record<string, number>;
}
export type HeroAbilityBuildAction =
  HeroBuildAction | { type: "ability"; id: string; level: number };
export const requiredHeroLevel = (rule: HeroAbilityRule, rank: number) =>
  rank <= rule.freeLevel
    ? 1
    : rule.requiredLevel + (rank - rule.freeLevel - 1) * rule.interval;
const talentCost = (state: HeroBuildState, talents: readonly HeroTalent[]) => {
  const counts = new Map<number, number>();
  for (const id of state.selectedTalents) {
    const talent = talents.find((t) => t.id === id);
    if (talent) counts.set(talent.level, (counts.get(talent.level) ?? 0) + 1);
  }
  return [...counts].reduce(
    (sum, [tier, count]) =>
      sum +
      (state.level >= secondTalentLevel(tier as HeroTalent["level"])
        ? Math.min(1, count)
        : count),
    0,
  );
};
const groups = (rules: readonly HeroAbilityRule[]) => [
  ...new Map(
    rules
      .filter((r) => !r.dependentOn)
      .toSorted((a, b) => Number(b.fixed) - Number(a.fixed))
      .map((r) => [r.group, r]),
  ).values(),
];

export function normalizeAbilityBuild(
  state: HeroAbilityBuildState,
  talents: readonly HeroTalent[],
  rules: readonly HeroAbilityRule[],
): HeroAbilityBuildState {
  const base = normalizeHeroBuild(state, talents);
  const abilityLevels: Record<string, number> = {};
  let budget = Math.max(0, base.level - talentCost(base, talents));
  for (const rule of groups(rules)) {
    const allowed = Math.max(
      rule.freeLevel,
      Math.min(
        rule.maxLevel,
        rule.freeLevel +
          Math.max(
            0,
            Math.floor((base.level - rule.requiredLevel) / rule.interval) + 1,
          ),
      ),
    );
    const input = state.abilityLevels[rule.group] ?? rule.freeLevel;
    const rank = rule.fixed
      ? rule.freeLevel
      : Math.max(
          rule.freeLevel,
          Math.min(
            allowed,
            Number.isFinite(input) ? Math.trunc(input) : rule.freeLevel,
            budget + rule.freeLevel,
          ),
        );
    abilityLevels[rule.group] = rank;
    if (!rule.fixed) budget -= rank - rule.freeLevel;
  }
  return { ...base, abilityLevels };
}

export function heroAbilityLevel(
  state: HeroAbilityBuildState,
  rule: HeroAbilityRule,
  rules: readonly HeroAbilityRule[],
  upgrades = { scepter: false, shard: false },
  seen = new Set<string>(),
): number {
  if (rule.upgrade && !upgrades[rule.upgrade]) return 0;
  if (seen.has(rule.id)) return 0;
  seen.add(rule.id);
  if (rule.dependentOn) {
    const parent = rules.find((r) => r.id === rule.dependentOn);
    return parent
      ? Math.min(
          rule.maxLevel,
          rule.freeLevel +
            heroAbilityLevel(state, parent, rules, upgrades, seen),
        )
      : 0;
  }
  return Math.min(
    rule.maxLevel,
    state.abilityLevels[rule.group] ?? rule.freeLevel,
  );
}

export function updateAbilityBuild(
  state: HeroAbilityBuildState,
  action: HeroAbilityBuildAction,
  talents: readonly HeroTalent[],
  rules: readonly HeroAbilityRule[],
): HeroAbilityBuildState {
  const current = normalizeAbilityBuild(state, talents, rules);
  if (action.type !== "ability") {
    const next = { ...current, ...updateHeroBuild(current, action, talents) };
    // Selecting a talent preserves existing skills by raising the point budget.
    if (action.type === "talent") {
      const spent = groups(rules).reduce(
        (sum, r) =>
          sum +
          (r.fixed
            ? 0
            : (current.abilityLevels[r.group] ?? r.freeLevel) - r.freeLevel),
        0,
      );
      next.level = clampHeroLevel(
        Math.max(next.level, spent + talentCost(next, talents)),
      );
    }
    return normalizeAbilityBuild(next, talents, rules);
  }
  const rule = rules.find((r) => r.id === action.id);
  if (!rule || rule.fixed || rule.dependentOn || !Number.isFinite(action.level))
    return current;
  const rank = Math.max(
    rule.freeLevel,
    Math.min(rule.maxLevel, Math.trunc(action.level)),
  );
  if (requiredHeroLevel(rule, rank) > 30) return current;
  const abilityLevels = { ...current.abilityLevels, [rule.group]: rank };
  const spent = groups(rules).reduce(
    (sum, r) =>
      sum +
      (r.fixed ? 0 : (abilityLevels[r.group] ?? r.freeLevel) - r.freeLevel),
    0,
  );
  return normalizeAbilityBuild(
    {
      ...current,
      abilityLevels,
      level: clampHeroLevel(
        Math.max(
          current.level,
          requiredHeroLevel(rule, rank),
          spent + talentCost(current, talents),
        ),
      ),
    },
    talents,
    rules,
  );
}
