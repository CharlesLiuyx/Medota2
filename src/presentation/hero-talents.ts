import type {
  HeroTalent,
  HeroStatModifier,
  FlatHeroStat,
  TalentTier,
} from "@/domain/hero-build";
import type { Locale } from "@/i18n/locale";
import { translate } from "@/i18n/messages";
import { displayName, textValues, type TooltipAbility } from "./dota";
import { supportsHeroStats } from "./hero-stats";

// Identity selects semantics; the current Catalog value supplies the amount.
// Never infer a value from an ID suffix (mp_regen_150 is actually 1.5).
const flatTargets: Record<string, FlatHeroStat[]> = {
  strength: ["strength"],
  agility: ["agility"],
  intelligence: ["intelligence"],
  all_stats: ["strength", "agility", "intelligence"],
  agility_and_intelligence: ["agility", "intelligence"],
  hp: ["health"],
  mp: ["mana"],
  hp_regen: ["healthRegen"],
  mp_regen: ["manaRegen"],
  attack_damage: ["attackDamage"],
  attack_base_damage: ["attackDamage"],
  armor: ["armor"],
  attack_speed: ["attackSpeed"],
  movement_speed: ["movementSpeed"],
  attack_range: ["attackRange"],
  day_vision: ["dayVision"],
  night_vision: ["nightVision"],
  vision: ["dayVision", "nightVision"],
};

export function adaptHeroTalents(
  talents: readonly TooltipAbility[],
  spellbook: readonly TooltipAbility[],
  sourceCommit: string | null,
  locale: Locale,
): HeroTalent[] {
  return talents.slice(0, 8).map((talent, index) => {
    const id = talent.internal_name;
    const family = /^special_bonus_([a-z_]+)_\d+$/.exec(id)?.[1];
    const rows = talent.values.filter((row) => row.value_key === "value");
    const row = rows[0];
    const raw = row?.level_values.length
      ? row.level_values.length === 1
        ? row.level_values[0]
        : null
      : row?.scalar_value;
    const amount =
      typeof raw === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw.trim())
        ? Number(raw)
        : null;
    let effects: HeroStatModifier[] = [];
    if (
      supportsHeroStats(sourceCommit) &&
      family &&
      amount !== null &&
      rows.length === 1 &&
      !row.modifiers?.length
    ) {
      effects = (flatTargets[family] ?? []).map((stat) => ({
        kind: "flat",
        stat,
        amount,
      }));
      if (family === "magic_resistance")
        effects = [{ kind: "resistance", stat: "magicResistance", amount }];
      if (family === "movement_speed_percentage")
        effects = [{ kind: "percent", stat: "movementSpeed", amount }];
      if (family === "mp_regen_amp")
        effects = [{ kind: "percent", stat: "manaRegen", amount }];
    }
    const linked = spellbook.some(
      (ability) =>
        ability.internal_name !== id &&
        ability.values.some((value) =>
          value.modifiers?.some((modifier) => modifier.key === id),
        ),
    );
    return {
      id,
      name: displayName(
        talent.display_name,
        translate(locale, "天赋说明待补充"),
        textValues(talent.values, talent, locale),
        locale,
      ),
      level: (10 + Math.floor(index / 2) * 5) as TalentTier,
      side: (index % 2) as 0 | 1,
      effects,
      coverage: effects.length ? "stats" : linked ? "ability" : "unmodeled",
    };
  });
}
