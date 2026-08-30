import { describe, expect, it } from "vitest";
import {
  compareReferenceHeroes,
  type CanonicalComparisonHero,
} from "@/importers/dotaconstants/comparator";

describe("dotaconstants reference comparator", () => {
  it("reports stale values without mutating canonical input", () => {
    const canonical = canonicalHero();
    const before = structuredClone(canonical);
    const reference = {
      id: 1,
      name: "npc_dota_hero_antimage",
      primary_attr: "agi",
      attack_type: "Melee",
      roles: ["Nuker", "Carry", "Escape"],
      base_health: 999,
      base_mana: 75,
      base_health_regen: 0.5,
      base_mana_regen: 0,
      base_armor: 0,
      base_mr: 25,
      base_attack_min: 20,
      base_attack_max: 24,
      base_str: 21,
      base_agi: 24,
      base_int: 12,
      str_gain: 2,
      agi_gain: 2,
      int_gain: 2,
      attack_range: 150,
      projectile_speed: 0,
      attack_rate: 1.7,
      base_attack_time: 100,
      attack_point: 0.3,
      move_speed: 310,
      turn_rate: 0.6,
      cm_enabled: true,
      day_vision: 1800,
      night_vision: 800,
      localized_name: "Anti-Mage",
    };
    const result = compareReferenceHeroes(
      [canonical],
      [{ hero_id: 1, internal_name: reference.name, raw_record: reference }],
    );
    expect(result.matchedCount).toBe(1);
    expect(result.diffs).toEqual([
      expect.objectContaining({
        fieldName: "base_health",
        canonicalValue: "120",
        referenceValue: "999",
      }),
    ]);
    expect(canonical).toEqual(before);
  });
});

function canonicalHero(): CanonicalComparisonHero {
  return {
    hero_id: 1,
    internal_name: "npc_dota_hero_antimage",
    primary_attribute: "agility",
    attack_type: "melee",
    roles: ["carry", "escape", "nuker"],
    base_health: "120.000000",
    base_mana: "75.000000",
    base_health_regen: "0.500000",
    base_mana_regen: "0.000000",
    base_armor: "0.000000",
    magic_resistance: "25.000000",
    base_attack_damage_min: "20.000000",
    base_attack_damage_max: "24.000000",
    base_strength: "21.000000",
    base_agility: "24.000000",
    base_intelligence: "12.000000",
    strength_gain: "2.000000",
    agility_gain: "2.000000",
    intelligence_gain: "2.000000",
    attack_range: "150.000000",
    projectile_speed: "0.000000",
    attack_rate: "1.700000",
    attack_animation_point: "0.300000",
    base_attack_speed: "100.000000",
    movement_speed: "310.000000",
    turn_rate: "0.600000",
    cm_enabled: true,
    day_vision: "1800.000000",
    night_vision: "800.000000",
    english_name: "Anti-Mage",
  };
}
