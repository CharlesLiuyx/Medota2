export interface AttributeEnumValue {
  value: string;
  zh: string;
  en: string;
  summary: string;
}
const value = (value: string, zh: string, en: string, summary = "") => ({
  value,
  zh,
  en,
  summary,
});
export const ENUM_ATTRIBUTE_FIELDS: Record<string, string> = {
  SpellDispellableType: "dispel-type",
  AbilityUnitDamageType: "damage-type",
  SpellImmunityType: "spell-immunity",
  AbilityUnitTargetTeam: "target-team",
  AbilityUnitTargetType: "target-type",
  AbilityUnitTargetFlags: "target-flags",
  AbilityBehavior: "ability-behavior",
  AttributePrimary: "primary-attribute",
  AttackCapabilities: "attack-capability",
  MovementCapabilities: "movement-capability",
  AttackDamageType: "attack-damage-type",
  ArmorType: "armor-type",
  CombatClassAttack: "attack-damage-type",
  CombatClassDefend: "armor-type",
};
export const ENUM_ATTRIBUTES: Array<{
  id: string;
  zh: string;
  en: string;
  unit: string;
  summary: string;
  scope: string;
  related: string[];
  valueType: "enum" | "flags";
  enumValues: AttributeEnumValue[];
}> = [
  {
    id: "dispel-type",
    zh: "驱散类型",
    en: "Dispel type",
    unit: "枚举值",
    valueType: "enum",
    summary: "说明技能效果能否被驱散，以及需要的驱散强度。",
    scope:
      "这是效果的可驱散性，不表示该技能本身能够施加何种驱散。同一技能的不同效果可能有例外；未声明不等于无法驱散。",
    related: ["status-resistance"],
    enumValues: [
      value(
        "SPELL_DISPELLABLE_YES",
        "可驱散",
        "Dispellable",
        "普通驱散即可移除适用效果，强驱散也可移除；目标与正负效果限制仍按机制处理。",
      ),
      value(
        "SPELL_DISPELLABLE_YES_STRONG",
        "仅强驱散",
        "Strong dispels only",
        "普通驱散无法移除，需要强驱散。",
      ),
      value(
        "SPELL_DISPELLABLE_NO",
        "无法驱散",
        "Cannot be dispelled",
        "普通与强驱散均不能移除该效果；死亡或特殊移除规则另行处理。",
      ),
    ],
  },
  {
    id: "damage-type",
    zh: "伤害类型",
    en: "Damage type",
    unit: "枚举值",
    valueType: "enum",
    summary: "定义伤害按物理、魔法或纯粹规则结算。",
    scope: "伤害类型与伤害来源分开；普通攻击也可能附带其他类型的伤害。",
    related: ["damage", "armor", "magic-resistance"],
    enumValues: [
      value(
        "DAMAGE_TYPE_PHYSICAL",
        "物理",
        "Physical",
        "通常受护甲影响，格挡与其他修正另外结算。",
      ),
      value(
        "DAMAGE_TYPE_MAGICAL",
        "魔法",
        "Magical",
        "通常受魔法抗性影响，免疫与特殊修正规则另行处理。",
      ),
      value(
        "DAMAGE_TYPE_PURE",
        "纯粹",
        "Pure",
        "不按护甲或魔法抗性减免，仍可能受其他伤害规则影响。",
      ),
      value(
        "DAMAGE_TYPE_NONE",
        "无伤害",
        "None",
        "来源明确声明无伤害类型，不与未提供字段混淆。",
      ),
    ],
  },
  {
    id: "spell-immunity",
    zh: "减益免疫",
    en: "Debuff immunity",
    unit: "枚举值",
    valueType: "enum",
    summary: "声明技能与目标减益免疫的交互。",
    scope:
      "来源仍沿用SpellImmunity字段名；能否选取、施加效果与造成伤害不能仅由此字段相互推导。",
    related: ["dispel-type", "damage-type"],
    enumValues: [
      value(
        "SPELL_IMMUNITY_ENEMIES_NO",
        "不无视减益免疫",
        "Does not pierce debuff immunity",
      ),
      value(
        "SPELL_IMMUNITY_ENEMIES_YES",
        "无视减益免疫",
        "Pierces debuff immunity",
      ),
      value(
        "SPELL_IMMUNITY_ALLIES_YES",
        "可对减益免疫友军施放",
        "Can target debuff-immune allies",
      ),
      value(
        "SPELL_IMMUNITY_ALLIES_NO",
        "不可对减益免疫友军施放",
        "Cannot target debuff-immune allies",
      ),
    ],
  },
  {
    id: "target-team",
    zh: "目标阵营",
    en: "Target team",
    unit: "枚举值",
    valueType: "flags",
    summary: "定义技能允许作用的友方或敌方阵营。",
    scope: "阵营过滤与目标类型、目标标记共同生效。",
    related: ["target-type", "target-flags"],
    enumValues: [
      value("DOTA_UNIT_TARGET_TEAM_FRIENDLY", "友方", "Friendly"),
      value("DOTA_UNIT_TARGET_TEAM_ENEMY", "敌方", "Enemy"),
      value("DOTA_UNIT_TARGET_TEAM_BOTH", "双方", "Both"),
      value("DOTA_UNIT_TARGET_TEAM_NONE", "无", "None"),
    ],
  },
  {
    id: "target-type",
    zh: "目标类型",
    en: "Target type",
    unit: "多选标记",
    valueType: "flags",
    summary: "定义技能允许作用的对象类别，可组合多个值。",
    scope: "多个标记是来源组合，不按普通数值加总。",
    related: ["target-team", "target-flags"],
    enumValues: [
      value("DOTA_UNIT_TARGET_HERO", "英雄", "Hero"),
      value("DOTA_UNIT_TARGET_BASIC", "普通单位", "Basic unit"),
      value("DOTA_UNIT_TARGET_CREEP", "非英雄单位", "Creep"),
      value("DOTA_UNIT_TARGET_BUILDING", "建筑", "Building"),
      value("DOTA_UNIT_TARGET_TREE", "树木", "Tree"),
      value("DOTA_UNIT_TARGET_ALL", "所有单位", "All units"),
    ],
  },
  {
    id: "target-flags",
    zh: "目标标记",
    en: "Target flags",
    unit: "多选标记",
    valueType: "flags",
    summary: "进一步限制或放宽目标选择的来源标记。",
    scope: "逐值保留原始标记；未审阅标记不猜测中文含义。",
    related: ["target-team", "target-type"],
    enumValues: [],
  },
  {
    id: "ability-behavior",
    zh: "技能类型",
    en: "Ability behavior",
    unit: "多选标记",
    valueType: "flags",
    summary: "技能的施放方式及行为标记，可以同时具有多个值。",
    scope: "被动、目标方式、持续施法与引擎行为标记分别保留；未知标记待解释。",
    related: ["cast-point", "cast-backswing", "channel-time"],
    enumValues: [
      value("DOTA_ABILITY_BEHAVIOR_PASSIVE", "被动", "Passive"),
      value("DOTA_ABILITY_BEHAVIOR_NO_TARGET", "无目标", "No target"),
      value("DOTA_ABILITY_BEHAVIOR_UNIT_TARGET", "单位目标", "Unit target"),
      value("DOTA_ABILITY_BEHAVIOR_POINT", "点目标", "Point target"),
      value("DOTA_ABILITY_BEHAVIOR_CHANNELLED", "持续施法", "Channeled"),
      value("DOTA_ABILITY_BEHAVIOR_TOGGLE", "切换", "Toggle"),
      value("DOTA_ABILITY_BEHAVIOR_AUTOCAST", "自动施法", "Autocast"),
      value(
        "DOTA_ABILITY_BEHAVIOR_IGNORE_BACKSWING",
        "DOTA_ABILITY_BEHAVIOR_IGNORE_BACKSWING",
        "DOTA_ABILITY_BEHAVIOR_IGNORE_BACKSWING",
        "忽略后摇的行为标记，不是后摇时长；具体执行规则待同版核验。",
      ),
    ],
  },
  {
    id: "attack-capability",
    zh: "攻击类型",
    en: "Attack type",
    unit: "枚举值",
    valueType: "enum",
    summary: "单位采用近战、远程或无普通攻击的方式。",
    scope: "远程分类不直接给出攻击距离、弹道速度或伤害类型。",
    related: ["attack-range", "projectile-speed"],
    enumValues: [
      value("DOTA_UNIT_CAP_MELEE_ATTACK", "近战", "Melee"),
      value("DOTA_UNIT_CAP_RANGED_ATTACK", "远程", "Ranged"),
      value("DOTA_UNIT_CAP_NO_ATTACK", "无法攻击", "No attack"),
    ],
  },
  {
    id: "movement-capability",
    zh: "移动类型",
    en: "Movement type",
    unit: "枚举值",
    valueType: "enum",
    summary: "单位定义中的地面、飞行或无移动能力。",
    scope: "移动方式与飞行视野、碰撞和穿越地形的临时效果分别判断。",
    related: ["movement-speed", "day-vision", "night-vision"],
    enumValues: [
      value("DOTA_UNIT_CAP_MOVE_GROUND", "地面", "Ground"),
      value("DOTA_UNIT_CAP_MOVE_FLY", "飞行", "Flying"),
      value("DOTA_UNIT_CAP_MOVE_NONE", "无法移动", "No movement"),
    ],
  },
  {
    id: "attack-damage-type",
    zh: "攻击伤害类别",
    en: "Attack damage class",
    unit: "枚举值",
    valueType: "enum",
    summary: "单位来源的攻击类别，用于攻击与防御类别的交互。",
    scope:
      "这是AttackDamageType分类，与物理、魔法、纯粹的伤害类型分开；倍率矩阵待同版核验。",
    related: ["armor-type", "damage-type"],
    enumValues: [],
  },
  {
    id: "armor-type",
    zh: "防御类型",
    en: "Defense type",
    unit: "枚举值",
    valueType: "enum",
    summary: "单位来源的防御类别。",
    scope: "防御类别和护甲数值不同；与攻击类别的具体倍率不能从名称推断。",
    related: ["attack-damage-type", "armor"],
    enumValues: [],
  },
];
export const PRIMARY_ATTRIBUTE_VALUES = [
  value("DOTA_ATTRIBUTE_STRENGTH", "力量", "Strength"),
  value("DOTA_ATTRIBUTE_AGILITY", "敏捷", "Agility"),
  value("DOTA_ATTRIBUTE_INTELLECT", "智力", "Intelligence"),
  value("DOTA_ATTRIBUTE_ALL", "全才", "Universal"),
];
export function enumAttributeFields(source: unknown) {
  const entries = (
    source as
      | { entries?: Array<{ key: string; value: unknown; line?: number }> }
      | undefined
  )?.entries;
  return (Array.isArray(entries) ? entries : []).flatMap((e) =>
    typeof e.value === "string" &&
    (ENUM_ATTRIBUTE_FIELDS[e.key] ||
      (/^(?:DOTA_|SPELL_|DAMAGE_|ABILITY_TYPE_)/.test(e.value) &&
        e.key !== "PingOverrideText"))
      ? [{ key: e.key, value: e.value, line: e.line }]
      : [],
  );
}
export function formatAttributeEnum(
  raw: string,
  values: AttributeEnumValue[] | undefined,
  locale: string,
) {
  if (!values) return raw;
  return raw
    .split("|")
    .map((part) => {
      const key = part.trim(),
        item = values.find((v) => v.value === key);
      return item ? (locale === "en" ? item.en : item.zh) : key;
    })
    .join(" · ");
}
