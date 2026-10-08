import type { ReadableChange } from "./entity-changes";
export type ChangeDirection = "buff" | "nerf" | "neutral";
export interface ChangeImpact {
  direction: ChangeDirection;
  percent: number | null;
  delta?: { values: number[]; unit: "number" | "seconds" | "percentagePoints" };
  score: number;
  rule: string;
  mixed?: boolean;
  pending?: boolean;
  basis?: { before: string; after: string };
}
/** Reviewed semantics, not fuzzy numeric polarity. Weights are editorial priority, not win-rate estimates. */
const rules: Array<{
  keys: string[];
  sign: number;
  weight: number;
  floor: number;
  label: string;
}> = [
  {
    keys: ["cooldown", "AbilityCooldown", "AbilityChargeRestoreTime"],
    sign: -1,
    weight: 1.5,
    floor: 5,
    label: "冷却越短，技能可用越频繁",
  },
  {
    keys: ["mana_cost", "AbilityManaCost"],
    sign: -1,
    weight: 0.8,
    floor: 50,
    label: "魔耗越低，资源负担越小",
  },
  {
    keys: ["ItemCost"],
    sign: -1,
    weight: 0.8,
    floor: 500,
    label: "价格越低，装备成型越快",
  },
  {
    keys: ["cast_point"],
    sign: -1,
    weight: 1.2,
    floor: 0.2,
    label: "前摇越短，施放越快",
  },
  {
    keys: ["base_armor"],
    sign: 1,
    weight: 1.3,
    floor: 10,
    label: "基础护甲提高有利于物理生存；以10点尺度比较",
  },
  {
    keys: ["base_health_regen"],
    sign: 1,
    weight: 0.8,
    floor: 2,
    label: "生命恢复提高有利于续航；以每秒2点尺度比较",
  },
  {
    keys: [
      "movement_speed",
      "bonus_movement_speed",
      "windwalk_movement_speed",
      "ally_movespeed_pct",
    ],
    sign: 1,
    weight: 2,
    floor: 20,
    label: "移动速度影响追击、逃生和转线",
  },
  {
    keys: [
      "base_strength",
      "base_agility",
      "base_intelligence",
      "strength_gain",
      "agility_gain",
      "intelligence_gain",
      "base_attack_speed",
      "base_attack_damage_min",
      "base_attack_damage_max",
    ],
    sign: 1,
    weight: 1,
    floor: 5,
    label: "基础属性提高有利于持续作战",
  },
  {
    keys: [
      "arrow_max_stun",
      "slow_duration",
      "push_duration",
      "static_duration",
    ],
    sign: 1,
    weight: 1.6,
    floor: 1,
    label: "控制时间越长，限制敌方行动越久",
  },
  {
    keys: [
      "cast_range",
      "eidolon_attack_range",
      "scepter_drag_speed",
      "radius",
    ],
    sign: 1,
    weight: 1.2,
    floor: 100,
    label: "作用距离或牵引速度提高有利于技能发挥",
  },
  {
    keys: [
      "damage",
      "bonus_damage",
      "rock_damage",
      "crush_damage",
      "blast_damage",
      "damage_per_second",
      "damage_duration",
      "damage_str",
      "damage_per_soul",
      "necromastery_damage_per_soul",
      "percent_damage_per_burn",
      "health_as_damage_pct",
      "eidolon_bonus_damage",
      "creep_damage",
      "hero_damage",
      "katana_bleed_attack_damage_pct",
    ],
    sign: 1,
    weight: 1,
    floor: 1,
    label: "伤害或伤害系数提高有利于输出",
  },
  {
    keys: [
      "heal_percentage",
      "illuminate_heal",
      "leech_heal",
      "heal_per_second",
      "heal_bonus",
      "lifesteal_percent",
      "lifesteal_creep",
      "bonus_mana_regen",
    ],
    sign: 1,
    weight: 1,
    floor: 1,
    label: "治疗、吸血或恢复提高有利于续航",
  },
  {
    keys: ["bonus_gold", "bonus_gold_self"],
    sign: 1,
    weight: 1.3,
    floor: 50,
    label: "额外金币提高有利于经济成长",
  },
  {
    keys: ["cooldown_reduction"],
    sign: 1,
    weight: 1.5,
    floor: 1,
    label: "减少更多冷却时间有利于技能周转",
  },
  {
    keys: ["presence_armor_reduction"],
    sign: -1,
    weight: 1.3,
    floor: 5,
    label: "负值减甲越深，敌方物理生存越低",
  },
];
export function numericLevels(text: string): number[] | null {
  const clean = text
    .trim()
    .replace(/\s*(?:秒|s|seconds?)$/iu, "")
    .replace(/%/gu, "");
  if (!/^[+\-\d.\s/]+$/u.test(clean)) return null;
  const values = clean
    .split(/[\s/]+/u)
    .filter(Boolean)
    .map(Number);
  return values.length && values.every(Number.isFinite) ? values : null;
}
export function assessChange(row: ReadableChange): ChangeImpact {
  const pending = (rule: string): ChangeImpact => ({
    direction: "neutral",
    percent: null,
    score: 0,
    rule,
    pending: true,
  });
  const specific: Record<
    string,
    { sign: number; weight: number; floor: number; label: string }
  > = {
    "necrolyte_sadist:hero_multiplier": {
      sign: 1,
      weight: 1,
      floor: 1,
      label: "英雄击杀的恢复倍数提高有利于续航",
    },
    "treant_living_armor:damage_block_threshold": {
      sign: 1,
      weight: 1,
      floor: 10,
      label: "最低格挡量提高有利于抵御伤害",
    },
    "treant_natures_guise:grace_time": {
      sign: 1,
      weight: 1,
      floor: 1,
      label: "离树后隐身保留更久，有利于穿行和逃生",
    },
    "treant_living_armor:duration": {
      sign: 1,
      weight: 1,
      floor: 5,
      label: "友方护甲增益持续更久，有利于保护目标",
    },
    "lone_druid_spirit_bear_entangle:counter_duration": {
      sign: 1,
      weight: 1,
      floor: 5,
      label: "伤害叠加保留更久，有利于持续攻击",
    },
    "item_mjollnir:static_duration": {
      sign: 1,
      weight: 1,
      floor: 5,
      label: "静电冲击护盾持续更久，有利于触发反击",
    },
  };
  const rule =
    specific[`${row.subject.key}:${row.field}`] ??
    rules.find((r) => r.keys.includes(row.field ?? ""));
  const beforeText = row.impactBasis?.before ?? row.before;
  const afterText = row.impactBasis?.after ?? row.after;
  const before = numericLevels(beforeText),
    after = numericLevels(afterText);
  if (!before || !after || beforeText.includes("%") !== afterText.includes("%"))
    return pending("文本、条件或计量方式变化，需结合实际效果判断");
  const length = Math.max(before.length, after.length);
  if (
    (before.length !== 1 && before.length !== length) ||
    (after.length !== 1 && after.length !== length)
  )
    return pending("等级结构不同，无法直接比较");
  const pairs = Array.from({ length }, (_, i) => [
    before[before.length === 1 ? 0 : i],
    after[after.length === 1 ? 0 : i],
  ]);
  const delta: ChangeImpact["delta"] = {
    values: pairs.map(([a, b]) => Number((b - a).toPrecision(12))),
    unit: beforeText.includes("%")
      ? "percentagePoints"
      : [beforeText, afterText, row.before, row.after].some((text) =>
            /(?:秒|s|seconds?)$/iu.test(text.trim()),
          )
        ? "seconds"
        : "number",
  };
  const relative = pairs.map(([a, b]) =>
    a === 0 ? (b === 0 ? 0 : null) : ((b - a) / Math.abs(a)) * 100,
  );
  const percent = relative.some((v) => v === null)
    ? null
    : relative.reduce<number>((n, v) => n + v!, 0) / length;
  if (!rule)
    return {
      ...pending("该字段的收益方向尚未核定"),
      percent,
      delta,
      basis: row.impactBasis,
    };
  const effects = pairs.map(([a, b]) => (b - a) * rule.sign);
  const mixed = effects.some((v) => v > 0) && effects.some((v) => v < 0);
  // Small denominators do not turn tiny base-stat adjustments into the largest gameplay changes.
  const score =
    (pairs.reduce(
      (n, [a, b]) =>
        n +
        Math.abs(b - a) /
          Math.max(Math.abs(a), rule.floor, row.scoreBaseline ?? 0),
      0,
    ) /
      length) *
    100 *
    rule.weight *
    (row.talent ? 0.6 : 1);
  return {
    delta,
    basis: row.impactBasis,
    direction: mixed
      ? "neutral"
      : effects.some((v) => v > 0)
        ? "buff"
        : effects.some((v) => v < 0)
          ? "nerf"
          : "neutral",
    percent,
    score,
    rule: rule.label,
    mixed,
  };
}
