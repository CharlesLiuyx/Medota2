import type {
  HeroStatusDefinition,
  InventoryEffect,
} from "@/domain/hero-inventory";
import type { StatusProvider } from "@/domain/hero-status-catalog";
import { supportsHeroStats } from "@/presentation/hero-stats";

export interface StatusSource {
  id: string;
  kind: "item" | "ability" | "building";
  name: string;
  enName: string;
  maxLevel: number | null;
  paths?: string[];
  providers: StatusProvider[];
  values: Array<{
    field: string;
    values: string[];
    name: string;
    enName: string;
  }>;
}
type FieldEffect = {
  field: string;
  kind: InventoryEffect["kind"];
  stat: string;
  group?: string;
};
// Explicit recipient bonuses, not a generic interpretation of AbilityValues.
// Checked against the pinned 7.41e/f definitions AND modifier descriptions.
const rules: Record<
  string,
  { source?: string; duration?: string; effects: FieldEffect[] }
> = {
  modifier_ogre_magi_bloodlust: {
    duration: "duration",
    effects: [
      { field: "bonus_movement_speed", kind: "percent", stat: "movementSpeed" },
      { field: "bonus_attack_speed", kind: "flat", stat: "attackSpeed" },
    ],
  },
  modifier_legion_commander_press_the_attack: {
    duration: "duration",
    effects: [
      { field: "move_speed", kind: "percent", stat: "movementSpeed" },
      { field: "hp_regen", kind: "flat", stat: "healthRegen" },
    ],
  },
  modifier_item_solar_crest_armor_addition: {
    duration: "duration",
    effects: [
      { field: "target_armor", kind: "flat", stat: "armor" },
      { field: "target_attack_speed", kind: "flat", stat: "attackSpeed" },
      {
        field: "target_movement_speed",
        kind: "percent",
        stat: "movementSpeed",
      },
    ],
  },
  modifier_item_buckler_effect: {
    effects: [
      {
        field: "bonus_aoe_armor",
        kind: "flat",
        stat: "armor",
        group: "buckler-aura",
      },
    ],
  },
  modifier_item_headdress_aura: {
    effects: [
      {
        field: "aura_health_regen",
        kind: "flat",
        stat: "healthRegen",
        group: "regen-aura:item_headdress",
      },
    ],
  },
  modifier_item_pipe_aura: {
    effects: [
      {
        field: "magic_resistance_aura",
        kind: "resistance",
        stat: "magicResistance",
        group: "pipe-aura",
      },
    ],
  },
  modifier_item_ancient_janggo_aura: {
    effects: [
      {
        field: "aura_movement_speed",
        kind: "flat",
        stat: "movementSpeed",
        group: "drum-aura",
      },
      {
        field: "aura_health_regen",
        kind: "flat",
        stat: "healthRegen",
        group: "regen-aura:item_ancient_janggo",
      },
    ],
  },
  modifier_satyr_hellcaller_unholy_aura_bonus: {
    effects: [{ field: "health_regen", kind: "flat", stat: "healthRegen" }],
  },
  modifier_ogre_magi_frost_armor: {
    duration: "duration",
    effects: [{ field: "armor_bonus", kind: "flat", stat: "armor" }],
  },
};
// Recipient effects reviewed from the pinned modifier descriptions. Unit-only
// passives (courier shield, backdoor protection, Roshan defenses, familiar
// transformations) are not states that a provider can put on the hero.
const unitRecipientModifiers = new Set(
  [
    "necronomicon_archer_purge",
    "warlock_golem_permanent_immolation_debuff",
    "beastmaster_boar_poison_effect",
    "broodmother_spawn_spiderite_debuff",
    "broodmother_poison_sting_debuff",
    "forged_spirit_melting_strike_debuff",
    "lone_druid_spirit_bear_entangle_effect",
    "brewmaster_storm_cyclone",
    "undying_tombstone_zombie_deathstrike_slow_counter",
    "roshan_revengeroar",
    "roshan_revengeroar_disarm",
    "miniboss_radiance_debuff",
    "miniboss_alleviation_active",
    "hill_troll_rally",
    "kobold_tunneler_prospecting_aura_money",
    "kobold_taskmaster_speed_aura_bonus",
    "forest_troll_high_priest_mana_aura_bonus",
    "forest_troll_high_priest_heal_amp_aura_bonus",
    "forest_troll_high_priest_heal_amp_bonus",
    "centaur_khan_endurance_aura_bonus",
    "furbolg_enrage_attack_speed",
    "furbolg_enrage_damage",
    "gnoll_assassin_envenomed_weapon_poison",
    "ghost_frost_attack_slow",
    "polar_furbolg_ursa_warrior_thunder_clap",
    "mudgolem_cloak_aura_bonus",
    "ogre_magi_frost_armor",
    "ogre_magi_frost_armor_slow",
    "dark_troll_warlord_ensnare",
    "giant_wolf_intimidate",
    "ice_shaman_incendiary_bomb",
    "frostbitten_golem_time_warp_aura_bonus",
    "alpha_wolf_command_aura_bonus",
    "tornado_tempest_debuff",
    "enraged_wildkin_hurricane",
    "flagbearer_creep_aura_effect",
    "enraged_wildkin_toughness_aura_bonus",
    "granite_golem_hp_aura_bonus",
    "spawnlord_aura_bonus",
    "spawnlord_master_freeze_root",
    "spawnlord_master_stomp",
    "satyr_trickster_purge",
    "satyr_hellcaller_unholy_aura_bonus",
    "black_dragon_dragonhide_aura_bonus",
    "big_thunder_lizard_slam",
    "big_thunder_lizard_frenzy",
    "big_thunder_lizard_wardrums_aura",
    "frogmen_riverborn_aura_bonus",
    "frogmen_arm_of_the_deep_stun",
    "tower_aura_bonus",
  ].map((name) => `modifier_${name}`),
);
const unitOnlyModifiers = new Set(
  [
    "warlock_golem_permanent_immolation",
    "brewmaster_storm_wind_walk",
    "brewmaster_fire_permanent_immolation",
    "visage_summon_familiars_stone_form_buff",
    "visage_gravekeepers_cloak_secondary",
    "visage_summon_familiars_recall",
    "roshan_spell_block",
    "roshan_devotion",
    "miniboss_unyielding_shield",
    "miniboss_reflect",
    "miniboss_radiance",
    "furbolg_enrage_attack_speed_on_death",
    "gnoll_assassin_envenomed_weapon",
    "ghost_frost_attack",
    "neutral_spell_immunity_visible",
    "mudgolem_cloak_aura",
    "alpha_wolf_critical_strike",
    "mud_golem_rock_destroy",
    "harpy_scout_take_off",
    "courier_shield",
    "backdoor_protection",
    "backdoor_protection_active",
    "tower_aura",
    "kobold_tunneler_prospecting",
  ].map((name) => `modifier_${name}`),
);
const clean = (text: string) =>
  text
    .replace(/<[^>]*>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
const numeric = (raw: string | undefined) =>
  raw !== undefined && /^[+-]?(?:\d+\.?\d*|\.\d+)$/u.test(raw)
    ? Number(raw)
    : null;
export function adaptHeroStatuses(
  sources: StatusSource[],
  zh: Record<string, string>,
  en: Record<string, string>,
  commit: string,
) {
  const unique = new Set<string>();
  for (const source of sources) {
    if (unique.has(source.id))
      throw new Error(`Duplicate status source: ${source.id}`);
    unique.add(source.id);
  }
  const ordered = [...sources].sort((a, b) => b.id.length - a.id.length);
  const statuses: HeroStatusDefinition[] = [];
  const tokenPrefix = "dota_tooltip_";
  for (const key of new Set([...Object.keys(en), ...Object.keys(zh)])) {
    if (
      !/^dota_tooltip_modifier_[a-z0-9_]+$/u.test(key) ||
      key.endsWith("_description")
    )
      continue;
    const modifier = key.slice(tokenPrefix.length);
    if (unitOnlyModifiers.has(modifier)) continue;
    const suffix = modifier.slice("modifier_".length);
    const rule = rules[modifier];
    const source = rule?.source
      ? sources.find((s) => s.id === rule.source)
      : ordered.find((s) => suffix === s.id || suffix.startsWith(`${s.id}_`));
    if (!source || !source.providers.length) continue;
    // Localization may retain obsolete/internal modifiers. Require an actual
    // description and a provider bound in this Catalog; prefix links stay marked.
    const description = zh[`${key}_description`] || en[`${key}_description`];
    if (!description) continue;
    const maxLevel = Math.min(
      30,
      Math.max(
        1,
        source.maxLevel ??
          Math.max(1, ...source.values.map((v) => v.values.length)),
      ),
    );
    const value = (field: string, level: number) => {
      const values = source.values.find((v) => v.field === field)?.values;
      if (!values?.length || values.length > maxLevel) return null;
      return numeric(values[Math.min(level - 1, values.length - 1)]);
    };
    const levels = Array.from({ length: maxLevel }, (_, i) => ({
      effects: supportsHeroStats(commit)
        ? (rule?.effects ?? []).flatMap((effect) => {
            const amount = value(effect.field, i + 1);
            return amount === null
              ? []
              : [
                  {
                    ...effect,
                    amount,
                    group: effect.group ?? `external:${modifier}`,
                  } as InventoryEffect,
                ];
          })
        : [],
      duration: rule?.duration ? value(rule.duration, i + 1) : null,
    }));
    for (const provider of source.providers) {
      if (
        !["hero", "item"].includes(provider.kind) &&
        !unitRecipientModifiers.has(modifier)
      )
        continue;
      statuses.push({
        id: `external:${provider.id}:${modifier}`,
        item: source.kind === "item" ? source.id : "",
        name: clean(zh[key] || en[key] || modifier),
        enName: clean(en[key] || zh[key] || modifier),
        description: clean(description),
        enDescription: clean(en[`${key}_description`] || description),
        provider,
        sourceAbility:
          source.kind === "ability"
            ? { id: source.id, name: source.name, enName: source.enName }
            : undefined,
        group: `external:${modifier}`,
        effects: levels[0].effects,
        duration: levels[0].duration,
        cost: 0,
        sourceModifier: modifier,
        sourceFields: rule?.effects.map((e) => e.field) ?? [],
        sourcePaths: source.paths ?? [],
        levels,
        mapping: rule || source.kind === "building" ? "reviewed" : "prefix",
        coverage: levels.some((l) => l.effects.length)
          ? "partial"
          : "unmodeled",
        parameters: source.values,
      });
    }
  }
  return statuses;
}
