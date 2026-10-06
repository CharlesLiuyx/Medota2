/** Player-facing vocabulary. Unknown engine metadata never becomes a label. */
export const labels: Record<string, string> = {
  strength: "力量",
  agility: "敏捷",
  intelligence: "智力",
  universal: "全才",
  melee: "近战",
  ranged: "远程",
  radiant: "天辉",
  dire: "夜魇",
  carry: "核心",
  support: "辅助",
  nuker: "爆发",
  disabler: "控制",
  durable: "耐久",
  escape: "逃生",
  pusher: "推进",
  initiator: "先手",
  current: "当前技能",
  indirect: "关联技能",
  defined_unbound: "其他技能",
  template: "技能模板",
  deprecated: "历史技能",
  loadout: "英雄技能",
  talent: "天赋",
  draft: "技能征召",
  facet: "命石技能",
  linked: "关联效果",
  sub_ability: "子技能",
  upgrade_granted: "升级解锁",
  declared_in_hero_file: "其他技能",
  DAMAGE_TYPE_MAGICAL: "魔法",
  DAMAGE_TYPE_PHYSICAL: "物理",
  DAMAGE_TYPE_PURE: "纯粹",
  DAMAGE_TYPE_NONE: "无伤害",
  DOTA_UNIT_TARGET_TEAM_ENEMY: "敌方",
  DOTA_UNIT_TARGET_TEAM_FRIENDLY: "友方",
  DOTA_UNIT_TARGET_TEAM_BOTH: "双方",
  DOTA_UNIT_TARGET_HERO: "英雄",
  DOTA_UNIT_TARGET_BASIC: "普通单位",
  DOTA_UNIT_TARGET_BUILDING: "建筑",
  DOTA_UNIT_TARGET_TREE: "树木",
  DOTA_UNIT_TARGET_CREEP: "非英雄单位",
  DOTA_UNIT_TARGET_ALL: "所有单位",
  SPELL_IMMUNITY_ENEMIES_NO: "不无视减益免疫",
  SPELL_IMMUNITY_ENEMIES_YES: "无视减益免疫",
  SPELL_IMMUNITY_ALLIES_YES: "可对减益免疫友军施放",
  SPELL_IMMUNITY_ALLIES_NO: "不可对减益免疫友军施放",
  SPELL_DISPELLABLE_YES: "可驱散",
  SPELL_DISPELLABLE_NO: "不可驱散",
  SPELL_DISPELLABLE_YES_STRONG: "仅强驱散",
};
const behaviors: Record<string, string> = {
  PASSIVE: "被动",
  NO_TARGET: "无目标",
  UNIT_TARGET: "单位目标",
  POINT: "点目标",
  AOE: "范围效果",
  CHANNELLED: "持续施法",
  TOGGLE: "切换",
  AUTOCAST: "自动施法",
  ATTACK: "攻击效果",
  VECTOR_TARGETING: "矢量目标",
  OPTIONAL_UNIT_TARGET: "可选单位目标",
  OPTIONAL_POINT: "可选点目标",
  OPTIONAL_NO_TARGET: "可无目标施放",
};
export function behaviorLabels(value: unknown): string[] {
  return (Array.isArray(value) ? value : String(value ?? "").split("|"))
    .map(
      (v) => behaviors[String(v).trim().replace("DOTA_ABILITY_BEHAVIOR_", "")],
    )
    .filter(Boolean);
}
export function enumText(value: unknown): string {
  const values = Array.isArray(value) ? value : String(value ?? "").split("|");
  return (
    values
      .map((v) => labels[String(v).trim()])
      .filter(Boolean)
      .join("、") || "未提供"
  );
}
export interface ValueRow {
  value_key: string;
  level_values: string[];
  scalar_value?: string | null;
  modifiers?: Array<{ key: string; value: unknown }>;
}
export function numbers(value: unknown): string {
  const raw = Array.isArray(value)
    ? value.map(String)
    : String(value ?? "")
        .trim()
        .split(/\s+/u);
  if (!raw.length || raw.some((v) => !/^[+-]?(?:\d+\.?\d*|\.\d+)%?$/u.test(v)))
    return "未提供";
  return raw
    .map((v) =>
      v.endsWith("%") ? `${Number(v.slice(0, -1))}%` : String(Number(v)),
    )
    .join(" / ");
}
export function textValues(
  values: ValueRow[],
  ability: Record<string, unknown> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of values)
    result[row.value_key.toLowerCase()] = numbers(
      row.level_values.length ? row.level_values : row.scalar_value,
    );
  for (const [token, key] of Object.entries({
    abilitycastrange: "cast_range",
    abilityduration: "duration",
    abilitychanneltime: "channel_time",
    abilitydamage: "damage",
    abilityhealthcost: "health_cost",
    abilitycharges: "charges",
    abilitychargerestoretime: "charge_restore_time",
    abilitycooldown: "cooldown",
    abilitymanacost: "mana_cost",
    abilitycastpoint: "cast_point",
  })) {
    if (ability[key] != null && result[token] === undefined)
      result[token] = numbers(ability[key]);
  }
  return result;
}
/** Plain text only: React escapes it. No upstream HTML is executed. */
export function gameText(
  input: string | null | undefined,
  values: Record<string, string> = {},
): string {
  return (input ?? "")
    .replace(/<br\s*\/?\s*>|<\/p>/giu, "\n")
    .replace(/<[^>]*>/gu, "")
    .replace(/\\n/gu, "\n")
    .replace(
      /%([\w]+)%/gu,
      (_, key: string) => values[key.toLowerCase()] ?? "（数值待补充）",
    )
    .replace(
      /\{[sdf]:([\w]+)\}/gu,
      (_, key: string) => values[key.toLowerCase()] ?? "（数值待补充）",
    )
    .replace(/%%/gu, "%")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/#[A-Za-z][\w]+/gu, "（说明待补充）")
    .trim();
}
export function displayName(
  value: string | null | undefined,
  fallback = "名称待补充",
  values: Record<string, string> = {},
): string {
  if (
    !value ||
    /^(?:npc_|special_bonus_|DOTA_)|^[a-z0-9]+(?:_[a-z0-9]+)+$/u.test(value)
  )
    return fallback;
  return gameText(value, values) || fallback;
}
const valueLabels: Record<string, string> = {
  damage: "伤害",
  damage_per_second: "每秒伤害",
  duration: "持续时间",
  radius: "作用范围",
  range: "距离",
  cast_range: "施法距离",
  blink_range: "闪烁距离",
  blink_range_clamp: "最大闪烁距离",
  stun_duration: "眩晕时间",
  slow_duration: "减速时间",
  movement_slow: "移动速度降低",
  movement_speed: "移动速度",
  attack_speed: "攻击速度",
  bonus_damage: "额外伤害",
  bonus_attack_speed: "额外攻击速度",
  bonus_armor: "额外护甲",
  armor_reduction: "护甲降低",
  heal: "治疗量",
  health_regen: "生命恢复",
  mana_regen: "魔法恢复",
  mana_cost: "魔法消耗",
  cooldown: "冷却时间",
  value: "加成数值",
  damage_pct: "伤害百分比",
  damage_delay: "伤害延迟",
  illusion_duration: "幻象持续时间",
  charges: "充能次数",
  charge_restore_time: "充能恢复时间",
  projectile_speed: "弹道速度",
  speed: "速度",
  width: "宽度",
  length: "长度",
  max_stacks: "最大叠加次数",
  chance: "触发概率",
  attack_range_bonus: "攻击距离加成",
  mana_per_hit: "每次攻击燃烧魔法",
  damage_per_burn: "每点燃烧魔法造成伤害",
  mana_void_damage_per_mana: "每点损失魔法造成伤害",
  mana_void_aoe_radius: "作用范围",
  vision_radius: "视野范围",
  min_damage: "最低伤害",
  max_damage: "最高伤害",
};
export function valueLabel(key: string, localized?: string): string | null {
  if (localized)
    return (
      gameText(localized)
        .replace(/^[%+$]+|[:：]+$/gu, "")
        .trim() || null
    );
  return valueLabels[key] ?? null;
}
export function tooltipValue(
  formatted: string,
  row: ValueRow,
  localized?: string,
): string {
  if (formatted === "未提供" || formatted.includes("待补充")) return formatted;
  const type = row.modifiers?.find((m) => m.key === "display_type")?.value;
  const percentages = [
    "kBuffPercentage",
    "kDebuffPercentage",
    "kHealthPercentage",
    "kHealthPercentageAsPureDamage",
    "kMagicalDamagePercentage",
    "kManaPercentage",
  ];
  if (localized?.startsWith("%") || percentages.includes(String(type)))
    return formatted.includes("%") ? formatted : `${formatted}%`;
  if (type === "kDuration" || type === "kDebuffDuration")
    return `${formatted} 秒`;
  return formatted;
}
export function relationLabel(value: string): string {
  return labels[value] ?? "关联技能";
}

/** AbilityValues overrides inherited top-level defaults in current game data. */
export function effectiveAbility<
  T extends { values: ValueRow[]; [key: string]: unknown },
>(ability: T): T {
  const result = { ...ability };
  const source = ability.source_definition as
    { entries?: Array<{ key: string; value: unknown }> } | undefined;
  const sourceFields: Record<string, string> = {
    AbilityDuration: "duration",
    AbilityHealthCost: "health_cost",
    AbilityCharges: "charges",
    AbilityChargeRestoreTime: "charge_restore_time",
  };
  for (const entry of source?.entries ?? []) {
    const field = sourceFields[entry.key];
    if (
      field &&
      typeof entry.value === "string" &&
      numbers(entry.value) !== "未提供"
    )
      (result as Record<string, unknown>)[field] = entry.value;
  }
  const fields: Record<string, string> = {
    abilitycooldown: "cooldown",
    abilitymanacost: "mana_cost",
    abilitycastrange: "cast_range",
    abilitycastpoint: "cast_point",
    abilitychanneltime: "channel_time",
    abilitydamage: "damage",
    abilityduration: "duration",
    abilityhealthcost: "health_cost",
    abilitycharges: "charges",
    abilitychargerestoretime: "charge_restore_time",
  };
  for (const row of ability.values) {
    const field = fields[row.value_key.toLowerCase()];
    if (field)
      (result as Record<string, unknown>)[field] = row.level_values.length
        ? row.level_values.join(" ")
        : row.scalar_value;
  }
  return result;
}
function parseModifier(
  input: unknown,
): Array<{ operation: string; amount: number; percent: boolean }> | null {
  if (typeof input !== "string") return null;
  const parts = input
    .trim()
    .split(/\s+/u)
    .map((part) => /^([+*=x]?)([+-]?(?:\d+\.?\d*|\.\d+))(%)?$/u.exec(part));
  if (!parts.length || parts.some((part) => !part)) return null;
  return parts.map((part) => ({
    operation: part![1] || (part![2].startsWith("-") ? "+" : "="),
    amount: Number(part![2]),
    percent: Boolean(part![3]),
  }));
}
export function upgradedValues(
  values: ValueRow[],
  kind: "scepter" | "shard",
): Record<string, string> {
  const result = textValues(values);
  for (const row of values) {
    const modifier = row.modifiers?.find(
      (m) => m.key === `special_bonus_${kind}`,
    )?.value;
    if (modifier === undefined) continue;
    const change = parseModifier(modifier);
    if (!change) {
      result[row.value_key.toLowerCase()] = "（数值待补充）";
      continue;
    }
    const base = row.level_values.length
      ? row.level_values
      : [row.scalar_value ?? "0"];
    result[row.value_key.toLowerCase()] = numbers(
      Array.from({ length: Math.max(base.length, change.length) }, (_, i) => {
        const delta = change[i] ?? change.at(-1)!;
        const old = Number(base[i] ?? base.at(-1));
        const amount = delta.percent
          ? (old * delta.amount) / 100
          : delta.amount;
        const value =
          delta.operation === "+"
            ? old + amount
            : delta.operation === "*" || delta.operation === "x"
              ? old * delta.amount
              : amount;
        return String(Number(value.toFixed(6)));
      }),
    );
  }
  return result;
}
export function talentValues(name: string, source: ValueRow[]): ValueRow[] {
  const result = new Map<string, ValueRow>();
  for (const row of source) {
    const modifier = parseModifier(
      row.modifiers?.find((m) => m.key === name)?.value,
    );
    if (!modifier) continue;
    const key = `bonus_${row.value_key}`;
    result.set(key, {
      value_key: key,
      level_values: modifier.map((v) => String(Math.abs(v.amount))),
    });
  }
  return [...result.values()];
}

export interface TooltipAbility {
  internal_name: string;
  display_name: string | null;
  description: string | null;
  lore?: string | null;
  scepter_description?: string | null;
  shard_description?: string | null;
  values: ValueRow[];
  [key: string]: unknown;
}
