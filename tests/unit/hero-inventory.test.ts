import { parseKeyValues } from "@/importers/keyvalues/parser";
import { describe, expect, it } from "vitest";
import { adaptItems } from "@/importers/dota-vpk/item-adapter";
import { adaptInventory } from "@/importers/dota-vpk/inventory-adapter";
import {
  emptyInventory,
  projectInventory,
  updateInventory,
  type InventoryAction,
} from "@/domain/hero-inventory";
import {
  heroStatContributions,
  heroStatsAtLevel,
} from "@/presentation/hero-stats";
import { abilityWithUpgrades } from "@/presentation/ability-upgrades";
import { abilityWithTalents } from "@/presentation/ability-talents";
import { abilityAtLevel } from "@/presentation/ability-levels";
import type { TooltipAbility } from "@/presentation/dota";

// Relevant fields transcribed from 7.41f/6944 items.txt at this pinned commit.
const commit = "f4c45719314754567cb4ef4fe343bbc790a311f4";
const source = {
  repository: "dota_vpk_updates",
  commit,
  path: "scripts/npc/items.txt",
  clientVersion: "6944",
};
const raw = `"DOTAAbilities" {
  "item_ultimate_scepter" { "ItemCost" "4200" "AbilityValues" { "bonus_all_stats" "10" "bonus_health" "175" "bonus_mana" "175" } }
  "item_ultimate_scepter_2" { "ItemCost" "5800" }
  "item_aghanims_shard" { "ItemCost" "1400" }
  "item_moon_shard" { "ItemCost" "4000" "AbilityValues" { "bonus_attack_speed" "140" "bonus_night_vision" "400" "consumed_bonus" "60" "consumed_bonus_night_vision" "200" } }
  "item_boots" { "ItemCost" "500" "AbilityValues" { "bonus_movement_speed" "45" } }
  "item_power_treads" { "ItemCost" "1400" "AbilityValues" { "bonus_movement_speed_ranged" "45" "bonus_movement_speed_melee" "55" "bonus_stat" "10" "bonus_attack_speed" "25" } }
  "item_hurricane_pike" { "ItemCost" "4450" "AbilityValues" { "bonus_strength" "15" "base_attack_range" "130" "bonus_attack_speed" "100" } }
  "item_tango" { "ItemCost" "90" "ItemInitialCharges" "3" "AbilityValues" { "health_regen" "7" "buff_duration" "16" } }
  "item_clarity" { "ItemCost" "60" "AbilityValues" { "mana_regen" "6" "buff_duration" "25" } }
  "item_armlet" { "ItemCost" "2500" "AbilityValues" { "bonus_strength" "0" "bonus_damage" "15" "bonus_attack_speed" "25" "bonus_armor" "6" "bonus_health_regen" "5" "unholy_bonus_strength" "25" "unholy_bonus_damage" "35" "unholy_bonus_armor" "4" "unholy_health_drain_per_second" "45" } }
  "item_dagon_3" { "ItemCost" "4650" "ItemBaseLevel" "3" "AbilityValues" { "bonus_all_stats" "6 7 8 9 10" "bonus_health" "200 210 220 230 240" } }
  "item_old" { "ItemCost" "0" "IsObsolete" "1" "AbilityValues" { "bonus_damage" "999" } }
  "item_recipe_old" { "ItemRecipe" "1" "ItemCost" "100" }
}`;
const catalog = adaptInventory(adaptItems(raw, {}, {}), source);
const axe = {
  internal_name: "npc_dota_hero_axe",
  primary_attribute: "strength",
  attack_type: "melee",
  base_strength: 25,
  strength_gain: 2.7,
  base_agility: 18,
  agility_gain: 1.7,
  base_intelligence: 18,
  intelligence_gain: 1.6,
  base_health: 120,
  base_health_regen: 2,
  base_mana: 75,
  base_mana_regen: 0,
  base_attack_damage_min: 31,
  base_attack_damage_max: 35,
  base_armor: 0,
  base_attack_speed: 100,
  magic_resistance: 25,
  movement_speed: 315,
  attack_range: 150,
  day_vision: 1800,
  night_vision: 800,
};
function scenario() {
  let state = emptyInventory();
  return {
    act(action: InventoryAction) {
      state = updateInventory(state, action, catalog);
      return state;
    },
    get state() {
      return state;
    },
    project(attackType = "melee") {
      return projectInventory(state, catalog, attackType);
    },
    stats() {
      return heroStatsAtLevel(
        axe,
        1,
        commit,
        projectInventory(state, catalog, "melee").modifiers,
      );
    },
  };
}
describe("same-version inventory and state projection", () => {
  it("distinguishes equipped, consumed and Alchemist gifted Scepters without retaining stale stats", () => {
    const s = scenario();
    s.act({ type: "equip", item: "item_ultimate_scepter", slot: 0 });
    expect(s.stats()).toMatchObject({
      strength: 35,
      health: 1065,
      mana: 586,
      damageMin: 66,
    });
    expect(s.project()).toMatchObject({
      inventoryValue: 4200,
      configurationValue: 4200,
      upgrades: { scepter: true, shard: false },
    });
    s.act({ type: "consume", slot: 0 });
    expect(s.state.slots.filter(Boolean)).toHaveLength(0);
    expect(s.stats()).toMatchObject({
      strength: 25,
      health: 670,
      mana: 291,
      damageMin: 56,
    });
    expect(s.project()).toMatchObject({
      inventoryValue: 0,
      configurationValue: 5800,
      upgrades: { scepter: true },
    });
    s.act({ type: "status", id: "scepter-gifted", enabled: true });
    expect(s.state.statuses).toEqual(["scepter-gifted"]);
    expect(s.stats()).toMatchObject({ strength: 35, health: 1065, mana: 586 });
    expect(s.project().configurationValue).toBe(0);
    s.act({ type: "equip", item: "item_ultimate_scepter", slot: 1 });
    expect(s.state.statuses).toEqual([]);
    expect(s.stats().strength).toBe(35);
    s.act({ type: "remove", slot: 1 });
    expect(s.stats().health).toBe(670);
    expect(s.project().upgrades.scepter).toBe(false);
  });
  it("consumes Shards and Blessings even with six full slots, idempotently", () => {
    const s = scenario();
    for (let slot = 0; slot < 6; slot++)
      s.act({ type: "equip", slot, item: "item_boots" });
    s.act({ type: "equip", slot: 0, item: "item_aghanims_shard" });
    s.act({ type: "equip", slot: 0, item: "item_aghanims_shard" });
    expect(s.state.slots.filter(Boolean)).toHaveLength(6);
    expect(s.state.statuses).toEqual(["shard"]);
    expect(s.project()).toMatchObject({
      configurationValue: 4400,
      upgrades: { scepter: false, shard: true },
    });
    expect(s.stats().movementSpeed).toBe(360);
    expect(s.act({ type: "equip", slot: 9, item: "item_boots" })).toEqual(
      s.state,
    );
    s.act({ type: "equip", slot: 0, item: "item_ultimate_scepter_2" });
    expect(s.state.slots.filter(Boolean)).toHaveLength(6);
    expect(s.project().upgrades.scepter).toBe(true);
  });
  it("turns Moon Shard into one permanent status; attack speed stacks, unique vision does not", () => {
    const s = scenario();
    s.act({ type: "equip", slot: 0, item: "item_moon_shard" });
    expect(s.stats()).toMatchObject({ attackSpeed: 258, nightVision: 1200 });
    s.act({ type: "consume", slot: 0 });
    expect(s.stats()).toMatchObject({ attackSpeed: 178, nightVision: 1000 });
    expect(s.project()).toMatchObject({
      inventoryValue: 0,
      configurationValue: 4000,
    });
    s.act({ type: "equip", slot: 1, item: "item_moon_shard" });
    expect(s.stats()).toMatchObject({ attackSpeed: 318, nightVision: 1200 });
    s.act({ type: "consume", slot: 1 });
    expect(s.state.slots[1]?.item).toBe("item_moon_shard");
    expect(s.state.statuses).toEqual(["moon-consumed"]);
    s.act({ type: "reset" });
    expect(s.state).toEqual(emptyInventory());
  });
  it("applies treads modes, strongest boots, item levels and ranged-only bonuses", () => {
    const s = scenario();
    s.act({ type: "equip", slot: 0, item: "item_power_treads" });
    s.act({ type: "equip", slot: 1, item: "item_boots" });
    expect(s.stats()).toMatchObject({
      strength: 35,
      attackSpeed: 143,
      movementSpeed: 370,
    });
    s.act({ type: "choice", slot: 0, choice: "agility" });
    expect(s.stats()).toMatchObject({
      strength: 25,
      agility: 28,
      attackSpeed: 153,
      armor: 4.48,
    });
    s.act({ type: "equip", slot: 2, item: "item_hurricane_pike" });
    expect(s.stats()).toMatchObject({ attackSpeed: 153, attackRange: 150 });
    const ranged = heroStatsAtLevel(
      { ...axe, attack_type: "ranged", attack_range: 600 },
      1,
      commit,
      s.project("ranged").modifiers,
    );
    expect(ranged).toMatchObject({ attackRange: 730, movementSpeed: 360 });
    s.act({ type: "equip", slot: 3, item: "item_dagon_3" });
    expect(s.stats().intelligence).toBe(26);
  });
  it("keeps consumable charges and temporary states separate from held passive bonuses", () => {
    const s = scenario();
    s.act({ type: "equip", slot: 0, item: "item_tango" });
    s.act({ type: "equip", slot: 1, item: "item_clarity" });
    expect(s.stats()).toMatchObject({ healthRegen: 4.5, manaRegen: 0.9 });
    s.act({ type: "consume", slot: 0 });
    expect(s.state.slots[0]?.charges).toBe(2);
    expect(s.stats().healthRegen).toBe(11.5);
    expect(s.project()).toMatchObject({
      inventoryValue: 120,
      configurationValue: 150,
    });
    s.act({ type: "consume", slot: 1 });
    expect(s.stats().manaRegen).toBe(6.9);
    s.act({ type: "status", id: "tango-regen", enabled: false });
    expect(s.stats().healthRegen).toBe(4.5);
  });
  it("uses a source-bound catalog and preserves unknown-version boundaries", () => {
    expect(catalog.items.some((item) => item.internalName === "item_old")).toBe(
      false,
    );
    expect(
      catalog.items.some((item) => item.internalName === "item_recipe_old"),
    ).toBe(false);
    const unknown = adaptInventory(adaptItems(raw, {}, {}), {
      ...source,
      commit: "a".repeat(40),
    });
    expect(unknown.supported).toBe(false);
    expect(
      updateInventory(
        emptyInventory(),
        { type: "equip", slot: 0, item: "item_ultimate_scepter" },
        unknown,
      ),
    ).toEqual(emptyInventory());
    expect(
      catalog.statuses.find((status) => status.id === "moon-consumed"),
    ).toMatchObject({
      sourceModifier: "modifier_item_moon_shard_consumed",
      sourceFields: ["consumed_bonus", "consumed_bonus_night_vision"],
    });
  });
});

it("projects upgrade-only zero bases, cooldown replacement and talents once at the selected skill level", () => {
  const ability: TooltipAbility = {
    internal_name: "axe_counter_helix",
    display_name: "反击螺旋",
    description: null,
    values: [
      {
        value_key: "damage",
        level_values: ["100", "120", "140", "160"],
        modifiers: [{ key: "special_bonus_unique_axe_4", value: "+40" }],
      },
      {
        value_key: "AbilityCooldown",
        level_values: ["0.3"],
        modifiers: [{ key: "special_bonus_scepter", value: "-0.3" }],
      },
      {
        value_key: "debuff_duration",
        level_values: [],
        scalar_value: null,
        modifiers: [{ key: "special_bonus_scepter", value: "+6" }],
      },
      {
        value_key: "should_stack",
        level_values: [],
        modifiers: [{ key: "special_bonus_shard", value: "1" }],
      },
    ],
  };
  const leveled = abilityAtLevel(ability, 4);
  const upgraded = abilityWithUpgrades(leveled, { scepter: true, shard: true });
  const final = abilityWithTalents(upgraded.ability, [
    "special_bonus_unique_axe_4",
  ]).ability;
  expect(final.cooldown).toBe("0");
  expect(final.values.map((row) => row.level_values[0])).toEqual([
    "200",
    "0",
    "6",
    "1",
  ]);
  expect(
    abilityWithUpgrades(leveled, { scepter: false, shard: false }).ability
      .cooldown,
  ).toBe("0.3");
  expect(ability.values[0].level_values).toEqual(["100", "120", "140", "160"]);
});
it("reports unresolved conditional upgrade values without inventing a numeric result", () => {
  const projection = abilityWithUpgrades(
    {
      internal_name: "example",
      display_name: null,
      description: null,
      is_granted_by_shard: true,
      values: [
        {
          value_key: "range",
          level_values: ["200"],
          modifiers: [
            {
              key: "special_bonus_shard",
              value: { condition: "unknown", value: "+100" },
            },
          ],
        },
      ],
    },
    { scepter: false, shard: true },
  );
  expect(projection.required).toBe("shard");
  expect(projection.unresolved).toEqual(["range"]);
  expect(projection.ability.values[0].level_values).toEqual([]);
});

describe("neutral tiers, enchantments and owner states", () => {
  const neutralDefinitions = `
    "item_stonefeather_satchel" { "ItemIsNeutralActiveDrop" "1" "ItemPurchasable" "0" "AbilityValues" { "feather_movespeed" "12" "rocks_armor" "3" "knockback_resistance" { "value" "30" "apply_curio_bonus" "1" } } }
    "item_duelist_gloves" { "ItemIsNeutralActiveDrop" "1" "ItemPurchasable" "0" "AbilityValues" { "bonus_attack_speed" { "value" "20" "apply_curio_bonus" "1" } } }
    "item_enchanters_bauble" { "ItemIsNeutralActiveDrop" "1" "ItemPurchasable" "0" "AbilityValues" { "enchantment_bonus_base" "10" "enchantment_bonus_growth" { "value" "35" "apply_curio_bonus" "1" } } }
    "item_enhancement_brawny" { "ItemIsNeutralPassiveDrop" "1" "ItemPurchasable" "0" "AbilityValues" { "health_bonus" "110 150 190 230" "health_regen" "0 3 6 9" "slow_resist" "0 0 0 25" } }
    "item_enhancement_crude" { "ItemIsNeutralPassiveDrop" "1" "ItemPurchasable" "0" "AbilityValues" { "health_restoration" "9 12 15" "bat_reduce" "6 9 12" "intelligence_pct" "-9" } }
    "item_enhancement_quickened" { "ItemIsNeutralPassiveDrop" "1" "ItemPurchasable" "0" "AbilityValues" { "movement_speed" "15 20 25 30" "max_mana" "0 100 160 220" "evasion" "0 0 0 15" } }
    "item_enhancement_alert" { "ItemIsNeutralPassiveDrop" "1" "ItemPurchasable" "0" "AbilityValues" { "bonus_attack_speed" "7 15 23 31" "bonus_attack_range" "0 0 0 80" "bonus_night_vision" "0 125 175 225" } }
    "item_enhancement_feverish" { "ItemIsNeutralPassiveDrop" "1" "ItemPurchasable" "0" "AbilityValues" { "cooldown_reduction" "15" "max_mana" "20" } }
    "item_retired_neutral" { "ItemIsNeutralActiveDrop" "1" "ItemPurchasable" "0" "AbilityValues" { "bonus_damage" "999" } }
  `;
  const pool = parseKeyValues(`"neutral_items" { "neutral_tiers" {
    "1" { "items" {"item_stonefeather_satchel" "1" "item_duelist_gloves" "1"} "enhancements" { "global" {"item_enhancement_quickened" "1"} "strength" {"item_enhancement_brawny" "1"} } }
    "2" { "items" {"item_stonefeather_satchel" "1"} "enhancements" { "strength" {"item_enhancement_crude" "1"} } }
    "5" { "items" {} "enhancements" { "global" {"item_enhancement_feverish" "1"} } }
    "4" { "items" {"item_enchanters_bauble" "1"} "enhancements" { "global" {"item_enhancement_quickened" "4" "item_enhancement_alert" "4"} "strength" {"item_enhancement_brawny" "4"} } }
  } }`);
  const snapshot = {
    ...adaptItems(
      raw.slice(0, raw.lastIndexOf("}")) + neutralDefinitions + "}",
      {},
      {},
    ),
    neutralRaw: pool,
  };
  const catalog = adaptInventory(snapshot, source, "strength");
  const run = (...actions: InventoryAction[]) =>
    actions.reduce((s, a) => updateInventory(s, a, catalog), emptyInventory());
  const stats = (s: ReturnType<typeof emptyInventory>) =>
    heroStatsAtLevel(
      { ...axe, attack_rate: 1.7 },
      1,
      commit,
      projectInventory(s, catalog, "melee").modifiers,
    );
  it("uses the active pool, primary-attribute candidates and exact enhancement level; never uses retired definitions", () => {
    expect(catalog.items.some((i) => i.category !== "equipment")).toBe(false);
    expect(
      catalog.neutralTiers[0].items.map((i) => i.internalName),
    ).not.toContain("item_retired_neutral");
    expect(
      adaptInventory(
        snapshot,
        source,
        "agility",
      ).neutralTiers[0].enchantments.map((i) => i.internalName),
    ).toEqual(["item_enhancement_quickened"]);
    const s = run({
      type: "neutral-equip",
      target: "enchantment",
      item: "item_enhancement_brawny",
    });
    expect(stats(s).health).toBe(780);
    const fourth = run(
      { type: "neutral-tier", tier: 4 },
      {
        type: "neutral-equip",
        target: "enchantment",
        item: "item_enhancement_brawny",
      },
    );
    expect(stats(fourth)).toMatchObject({
      health: 900,
      healthRegen: 13.5,
      slowResistance: 25,
    });
    expect(projectInventory(fourth, catalog, "melee").configurationValue).toBe(
      0,
    );
    expect(
      updateInventory(fourth, { type: "neutral-tier", tier: 1 }, catalog),
    ).toMatchObject({ enchantment: null, neutral: null, neutralTier: 1 });
    expect(
      updateInventory(
        s,
        {
          type: "neutral-equip",
          target: "neutral",
          item: "item_ultimate_scepter",
        },
        catalog,
      ),
    ).toEqual(s);
    expect(
      updateInventory(
        s,
        { type: "equip", slot: 0, item: "item_stonefeather_satchel" },
        catalog,
      ),
    ).toEqual(s);
  });
  it("models negative attributes and BAT reduction at the enhancement's source level, not the tier number", () => {
    const s = run(
      { type: "neutral-tier", tier: 2 },
      {
        type: "neutral-equip",
        target: "enchantment",
        item: "item_enhancement_crude",
      },
    );
    expect(stats(s)).toMatchObject({
      intelligence: 16.38,
      mana: 271.56,
      healthRegen: 4.905,
      baseAttackTime: 1.598,
    });
  });
  it("keeps conditional neutral passives inactive until selected, and respects source-marked Curio fields", () => {
    let s = run({
      type: "neutral-equip",
      target: "neutral",
      item: "item_duelist_gloves",
    });
    expect(stats(s).attackSpeed).toBe(118);
    s = updateInventory(s, { type: "neutral-choice", choice: "on" }, catalog);
    expect(stats(s).attackSpeed).toBe(138);
    s = updateInventory(s, { type: "curio", enabled: true }, catalog);
    expect(stats(s).attackSpeed).toBe(144);
    s = updateInventory(
      s,
      {
        type: "neutral-equip",
        target: "neutral",
        item: "item_stonefeather_satchel",
      },
      catalog,
    );
    expect(stats(s)).toMatchObject({
      movementSpeed: 327,
      armor: 2.88,
      knockbackResistance: -39,
    });
    s = updateInventory(
      s,
      { type: "neutral-choice", choice: "rocks" },
      catalog,
    );
    expect(stats(s)).toMatchObject({
      movementSpeed: 315,
      armor: 5.88,
      knockbackResistance: 39,
    });
    expect(updateInventory(s, { type: "reset" }, catalog)).toEqual(
      emptyInventory(),
    );
  });
  it("amplifies the chosen enchantment with Bauble recrafts and removes the amplification on removal", () => {
    let s = run(
      { type: "neutral-tier", tier: 4 },
      {
        type: "neutral-equip",
        target: "neutral",
        item: "item_enchanters_bauble",
      },
      {
        type: "neutral-equip",
        target: "enchantment",
        item: "item_enhancement_brawny",
      },
    );
    expect(stats(s).health).toBe(923);
    s = updateInventory(s, { type: "bauble-recrafts", count: 2 }, catalog);
    expect(stats(s).health).toBe(1084);
    expect(projectInventory(s, catalog, "melee").enchantmentMultiplier).toBe(
      1.8,
    );
    s = updateInventory(
      s,
      { type: "neutral-equip", target: "neutral", item: null },
      catalog,
    );
    expect(stats(s).health).toBe(900);
    expect(s.baubleRecrafts).toBe(0);
  });
  it("keeps a lower-tier artifact for tier-five enchantments and projects Feverish as a mana penalty", () => {
    const s = run(
      { type: "neutral-tier", tier: 4 },
      {
        type: "neutral-equip",
        target: "neutral",
        item: "item_enchanters_bauble",
      },
      { type: "bauble-recrafts", count: 2 },
      { type: "neutral-tier", tier: 5 },
      {
        type: "neutral-equip",
        target: "enchantment",
        item: "item_enhancement_feverish",
      },
    );
    expect(s.neutral?.tier).toBe(4);
    expect(stats(s)).toMatchObject({ mana: 186.24, cooldownReduction: 27 });
    expect(
      updateInventory(s, { type: "neutral-tier", tier: 1 }, catalog),
    ).toMatchObject({ neutral: null, enchantment: null, baubleRecrafts: 0 });
  });
  it("applies Alert attack range to melee and ranged as specified by the same-version attack_range_all token", () => {
    const s = run(
      { type: "neutral-tier", tier: 4 },
      {
        type: "neutral-equip",
        target: "enchantment",
        item: "item_enhancement_alert",
      },
    );
    expect(stats(s)).toMatchObject({
      attackRange: 230,
      attackSpeed: 149,
      nightVision: 1025,
    });
    expect(
      projectInventory(s, catalog, "ranged").modifiers.find(
        (e) => e.stat === "attackRange",
      )?.amount,
    ).toBe(80);
  });
  it("rejects malformed neutral tier and level data", () => {
    expect(() =>
      adaptInventory(
        {
          ...snapshot,
          neutralRaw: parseKeyValues(
            '"neutral_items" {"neutral_tiers" {"1" {"items" {"bad" "zero"}}}}',
          ),
        },
        source,
      ),
    ).toThrow(/Invalid neutral pool/);
  });
});

it("attributes effective sources without duplicating unique groups, including consumed bonuses", () => {
  let state = emptyInventory();
  for (const [slot, item] of [
    "item_ultimate_scepter",
    "item_boots",
    "item_boots",
    "item_moon_shard",
  ].entries()) {
    state = updateInventory(state, { type: "equip", slot, item }, catalog);
  }
  state = updateInventory(state, { type: "consume", slot: 3 }, catalog);
  const projection = projectInventory(state, catalog, "melee");
  let modifiers: typeof projection.modifiers = [];
  const stages = [
    { source: null, modifiers: [] },
    ...projection.sources.map((source) => {
      modifiers = [...modifiers, ...source.modifiers];
      return { source, modifiers };
    }),
  ];
  const parts = heroStatContributions(axe, 1, commit, [], stages);
  expect(
    parts.sources.find((source) => source.id === "slot:0")?.changes.health
      .amount,
  ).toBe(395);
  expect(projection.sources[0].upgrade).toBe("scepter");
  expect(
    parts.sources.find((source) => source.id === "slot:1")?.changes
      .movementSpeed.amount,
  ).toBe(45);
  expect(
    parts.sources.find((source) => source.id === "slot:2")?.changes,
  ).toEqual({});
  expect(
    parts.sources.find((source) => source.id === "status:moon-consumed")
      ?.changes.attackSpeed.amount,
  ).toBe(60);
  const total = heroStatsAtLevel(
    axe,
    1,
    commit,
    projection.modifiers,
  ).calculations;
  for (const [stat, node] of Object.entries(total)) {
    const initial = parts.base![stat as keyof typeof total].value;
    if (node.value !== null && initial !== null)
      expect(
        initial +
          parts.sources.reduce(
            (sum, source) => sum + (source.changes[stat]?.amount ?? 0),
            0,
          ),
      ).toBeCloseTo(node.value, 4);
  }
});

it("keeps signed and multiplicative source contributions equal to the final panel", () => {
  const first = {
    id: "slot:0",
    name: "resistance",
    modifiers: [
      {
        kind: "resistance" as const,
        stat: "magicResistance" as const,
        amount: 25,
      },
    ],
  };
  const second = {
    id: "enchantment",
    name: "penalty",
    modifiers: [
      {
        kind: "resistance" as const,
        stat: "magicResistance" as const,
        amount: 20,
      },
      { kind: "flat" as const, stat: "attackDamage" as const, amount: -70 },
    ],
  };
  const parts = heroStatContributions(
    axe,
    1,
    commit,
    [],
    [
      { source: null, modifiers: [] },
      { source: first, modifiers: first.modifiers },
      { source: second, modifiers: [...first.modifiers, ...second.modifiers] },
    ],
  );
  expect(parts.sources[0].changes.magicResistance.amount).toBe(18.3);
  expect(parts.sources[1].changes.magicResistance.amount).toBe(10.98);
  expect(parts.sources[1].changes.damageMin).toEqual({
    before: 56,
    after: -14,
    amount: -70,
  });
  expect(parts.sources[1].changes.magicResistance.after).toBe(56.08);
});
