/** Serializable build state. Source adaptation and React rendering stay outside. */
export type TalentTier = 10 | 15 | 20 | 25;
export type FlatHeroStat =
  | "strength"
  | "agility"
  | "intelligence"
  | "health"
  | "mana"
  | "healthRegen"
  | "manaRegen"
  | "attackDamage"
  | "armor"
  | "attackSpeed"
  | "movementSpeed"
  | "attackRange"
  | "dayVision"
  | "nightVision"
  | "spellAmplification"
  | "castRangeBonus"
  | "cooldownReduction"
  | "lifesteal"
  | "spellLifesteal"
  | "manaCostReduction"
  | "slowResistance"
  | "knockbackResistance"
  | "statusResistance"
  | "debuffAmplification"
  | "incomingDamage"
  | "onHitMagicDamage"
  | "castSpeed"
  | "goldPerMinute"
  | "healingAmplification"
  | "outgoingDamage"
  | "spellArea";
export type HeroStatModifier =
  | { kind: "flat"; stat: FlatHeroStat; amount: number }
  | {
      kind: "percent";
      stat:
        | "movementSpeed"
        | "manaRegen"
        | "healthRegen"
        | "mana"
        | "health"
        | "baseAttackSpeed"
        | "baseAttackDamage"
        | "maxHealthRegen"
        | "intelligence"
        | "attackSpeed"
        | "baseAttackTime"
        | "dayVision"
        | "nightVision"
        | "armor";
      amount: number;
    }
  | { kind: "resistance"; stat: "magicResistance" | "evasion"; amount: number };

export interface HeroTalent {
  id: string;
  name: string;
  level: TalentTier;
  side: 0 | 1;
  effects: HeroStatModifier[];
  coverage: "stats" | "ability" | "unmodeled";
}
export interface HeroBuildState {
  level: number;
  /** Selection order preserves the original side when lowering a double unlock. */
  selectedTalents: string[];
}
export type HeroBuildAction =
  | { type: "level"; level: number }
  | { type: "talent"; id: string }
  | { type: "clear-talents" };

export function clampHeroLevel(level: number) {
  return Number.isFinite(level)
    ? Math.max(1, Math.min(30, Math.trunc(level)))
    : 1;
}
/** Valve 7.29: remaining level 10/15/20/25 talents unlock at 27/28/29/30. */
export const secondTalentLevel = (tier: TalentTier) => 27 + (tier - 10) / 5;

export function normalizeHeroBuild(
  state: HeroBuildState,
  talents: readonly HeroTalent[],
): HeroBuildState {
  const level = clampHeroLevel(state.level);
  const counts = new Map<number, number>();
  const selectedTalents = [...new Set(state.selectedTalents)].filter((id) => {
    const talent = talents.find((entry) => entry.id === id);
    if (!talent || talent.level > level) return false;
    const count = counts.get(talent.level) ?? 0;
    if (count >= (level >= secondTalentLevel(talent.level) ? 2 : 1))
      return false;
    counts.set(talent.level, count + 1);
    return true;
  });
  return { level, selectedTalents };
}

export function updateHeroBuild(
  state: HeroBuildState,
  action: HeroBuildAction,
  talents: readonly HeroTalent[],
): HeroBuildState {
  const current = normalizeHeroBuild(state, talents);
  if (action.type === "level")
    return normalizeHeroBuild({ ...current, level: action.level }, talents);
  if (action.type === "clear-talents")
    return { ...current, selectedTalents: [] };
  const talent = talents.find((entry) => entry.id === action.id);
  if (!talent) return current;
  if (current.selectedTalents.includes(talent.id))
    return {
      ...current,
      selectedTalents: current.selectedTalents.filter((id) => id !== talent.id),
    };
  const selectedTalents = current.selectedTalents.filter(
    (id) =>
      current.level >= secondTalentLevel(talent.level) ||
      talents.find((entry) => entry.id === id)?.level !== talent.level,
  );
  return {
    level: Math.max(current.level, talent.level),
    selectedTalents: [...selectedTalents, talent.id],
  };
}

export function selectedHeroTalents(
  state: HeroBuildState,
  talents: readonly HeroTalent[],
) {
  const valid = normalizeHeroBuild(state, talents);
  return talents.filter((talent) => valid.selectedTalents.includes(talent.id));
}
