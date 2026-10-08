import {
  ENUM_ATTRIBUTES,
  ENUM_ATTRIBUTE_FIELDS,
  PRIMARY_ATTRIBUTE_VALUES,
  type AttributeEnumValue,
} from "./attribute-enums";
/** Attribute identity is semantic, never a translated label. Unknown values stay owner-scoped. */
export type AttributeOwnerKind = "hero" | "ability" | "unit" | "item";
export interface AttributeDefinition {
  valueType?: "number" | "enum" | "flags";
  enumValues?: AttributeEnumValue[];
  id: string;
  zh: string;
  en: string;
  unit: string;
  summary: string;
  scope: string;
  token?: string;
  related: string[];
}
const define = (
  id: string,
  zh: string,
  en: string,
  unit: string,
  summary: string,
  scope: string,
  token?: string,
  related: string[] = [],
): AttributeDefinition => ({
  valueType: "number",
  id,
  zh,
  en,
  unit,
  summary,
  scope,
  token,
  related,
});
export const ATTRIBUTES: AttributeDefinition[] = [
  define(
    "armor",
    "护甲",
    "Armor",
    "点",
    "决定单位承受物理伤害的比例；负护甲会增加所受物理伤害。",
    "基础护甲、额外护甲和减甲是不同来源。物品上的数值是来源贡献，不能直接当作总护甲或减伤百分比。",
    "Armor",
    ["agility", "health"],
  ),
  define(
    "strength",
    "力量",
    "Strength",
    "点",
    "英雄的基础属性，影响生命上限和生命恢复。",
    "基础值、每级成长、装备与技能加成分别记录。主属性与全才的攻击力换算另受版本规则影响。",
    "Strength",
    ["health", "health-regen"],
  ),
  define(
    "agility",
    "敏捷",
    "Agility",
    "点",
    "英雄的基础属性，影响护甲和攻击速度。",
    "属性面板的基础护甲尚未包含敏捷贡献；攻击速度不等于每秒攻击次数。",
    "Agility",
    ["armor", "attack-speed"],
  ),
  define(
    "intelligence",
    "智力",
    "Intelligence",
    "点",
    "英雄的基础属性，影响魔法上限、魔法恢复和基础魔法抗性。",
    "魔抗的百分比贡献不能直接推广为多个独立魔抗来源相加。",
    "Intelligence",
    ["mana", "mana-regen", "magic-resistance"],
  ),
  define(
    "health",
    "生命值",
    "Health",
    "点",
    "单位的生命资源；上限决定能够容纳的生命值。",
    "基础生命、生命上限加成、当前生命与治疗量不同；本页关联的是定义字段，不是对局实时生命。",
    "Health",
    ["strength", "health-regen", "armor"],
  ),
  define(
    "health-regen",
    "生命恢复",
    "Health regeneration",
    "点/秒",
    "随时间恢复生命的速率。",
    "区别于一次性治疗、吸血和按最大生命百分比恢复；恢复增幅与禁疗需另行结算。",
    "Health",
    ["health", "strength"],
  ),
  define(
    "mana",
    "魔法值",
    "Mana",
    "点",
    "施放技能等行为使用的魔法资源。",
    "基础魔法、魔法上限、当前魔法和魔法消耗是不同概念。",
    "Mana",
    ["intelligence", "mana-regen", "mana-cost"],
  ),
  define(
    "mana-regen",
    "魔法恢复",
    "Mana regeneration",
    "点/秒",
    "随时间恢复魔法的速率。",
    "固定恢复量与百分比恢复增幅分别结算，瞬间回复不属于持续恢复。",
    "Mana",
    ["mana", "intelligence"],
  ),
  define(
    "magic-resistance",
    "魔法抗性",
    "Magic resistance",
    "%",
    "决定单位承受魔法伤害的比例。",
    "不减免纯粹伤害；基础魔抗、独立加成和降低魔抗不能无条件相加。",
    "MagicResistance",
    ["intelligence", "health"],
  ),
  define(
    "attack-damage",
    "攻击力",
    "Attack damage",
    "点",
    "普通攻击的伤害数值。",
    "基础攻击力上下限与额外攻击力分开保留；不自动计入主属性、暴击或目标减伤。",
    "Damage",
    ["attack-speed", "armor"],
  ),
  define(
    "attack-speed",
    "攻击速度",
    "Attack speed",
    "点",
    "影响普通攻击动作频率的速度数值。",
    "基础攻速与额外攻速不同；基础攻击间隔、上下限和特殊攻击规则共同影响最终频率。",
    "AttackRate",
    ["attack-interval", "agility"],
  ),
  define(
    "attack-interval",
    "基础攻击间隔",
    "Base attack time",
    "秒",
    "攻击频率计算使用的基础时间。",
    "不是当前两次攻击的实际间隔；需结合总攻击速度，特殊技能可能替换基础间隔。",
    "AttackRate",
    ["attack-speed"],
  ),
  define(
    "attack-range",
    "攻击距离",
    "Attack range",
    "距离单位",
    "普通攻击能够选取目标的距离。",
    "不是技能施法距离，也不表示视野或追踪弹道的最远距离。",
    "AttackRange",
    ["cast-range", "day-vision"],
  ),
  define(
    "attack-point",
    "攻击前摇",
    "Attack point",
    "秒",
    "普通攻击动作从开始到攻击生效或弹道发出的基础时间。",
    "与攻击后摇、弹道飞行时间分开；实际时长可能随攻速变化。",
    undefined,
    ["attack-speed", "attack-backswing", "projectile-speed"],
  ),
  define(
    "attack-backswing",
    "攻击后摇",
    "Attack backswing",
    "秒",
    "普通攻击生效或弹道发出后的动作收尾时间。",
    "通常可以通过新指令取消以更早移动或执行其他动作；取消后摇不会重置攻击间隔。具体时长取决于动作与攻速，当前文本来源未提供完整数值，待同版本客户端核验。",
    undefined,
    ["attack-point", "attack-speed", "attack-interval"],
  ),
  define(
    "projectile-speed",
    "弹道速度",
    "Projectile speed",
    "距离单位/秒",
    "弹道移动的速度。",
    "普通攻击与技能弹道分别记录；加速、追踪、瞬发和弹道销毁不能由单一数值推断。",
    "ProjectileSpeed",
    ["attack-range"],
  ),
  define(
    "movement-speed",
    "移动速度",
    "Movement speed",
    "距离单位/秒",
    "单位在地图上的移动速率。",
    "基础速度、固定加成、百分比加成、减速与速度上下限属于不同结算环节。",
    "MovementSpeed",
    ["turn-rate"],
  ),
  define(
    "turn-rate",
    "转身速率",
    "Turn rate",
    "引擎单位",
    "控制单位转向的速率参数。",
    "不能直接把该参数当作度/秒；动画、朝向容差和引擎更新间隔仍需客户端核验。",
    "TurnRate",
    ["movement-speed"],
  ),
  define(
    "day-vision",
    "白天视野",
    "Day vision",
    "距离单位",
    "白天可见范围的基础半径。",
    "地形高度、树林、隐身、真视和共享视野另行影响可见性。",
    "SightRange",
    ["night-vision"],
  ),
  define(
    "night-vision",
    "夜间视野",
    "Night vision",
    "距离单位",
    "夜间可见范围的基础半径。",
    "夜间视野并不等于真视；特殊技能和昼夜规则可能覆盖基础值。",
    "SightRange",
    ["day-vision"],
  ),
  define(
    "cooldown",
    "冷却时间",
    "Cooldown",
    "秒",
    "技能或物品再次使用前的基础等待时间。",
    "充能恢复、共享冷却、冷却减少及重置规则需按技能处理。",
    undefined,
    ["mana-cost"],
  ),
  define(
    "mana-cost",
    "魔法消耗",
    "Mana cost",
    "点",
    "使用技能或物品需要支付的基础魔法量。",
    "百分比消耗、持续消耗、消耗降低和特殊支付条件应按来源说明解释。",
    undefined,
    ["mana", "cooldown"],
  ),
  define(
    "cast-range",
    "施法距离",
    "Cast range",
    "距离单位",
    "技能或物品施放时允许指定目标的位置范围。",
    "不等于作用半径、弹道行程或影响范围；加成与例外依具体行为决定。",
    undefined,
    ["attack-range"],
  ),
  define(
    "cast-point",
    "施法前摇",
    "Cast point",
    "秒",
    "开始施法到技能释放的基础时间。",
    "与持续施法时间及后摇不同，特殊动作和技能例外单独处理。",
    undefined,
    ["cast-backswing", "channel-time"],
  ),
  define(
    "cast-backswing",
    "施法后摇",
    "Cast backswing",
    "秒",
    "技能完成施放后的动作收尾时间。",
    "通常可以通过新指令取消；与施法前摇、持续施法分开。当前VPK仍有忽略后摇的行为标记，但标记不能证明具体时长为零。数值、指令队列及特殊技能规则待同版本客户端核验。",
    undefined,
    ["cast-point", "channel-time"],
  ),
  define(
    "channel-time",
    "持续施法时间",
    "Channel time",
    "秒",
    "技能需要持续引导的时间。",
    "中断条件和分段效果由技能决定，不等于增益或减益持续时间。",
  ),
  define(
    "gold-bounty",
    "金钱奖励",
    "Gold bounty",
    "金币",
    "单位定义中的击杀金钱奖励范围。",
    "最低值和最高值保留；实际归属、团队分配和随时间成长另有规则。",
  ),
  define(
    "experience-bounty",
    "经验奖励",
    "Experience bounty",
    "经验",
    "单位定义中的击杀经验奖励。",
    "实际获取受范围、分摊、反补和特殊技能规则影响。",
  ),
  define(
    "level",
    "等级",
    "Level",
    "级",
    "单位定义中的等级参数。",
    "非英雄单位等级与玩家英雄当前等级不同，不能据此推断升级曲线。",
  ),
  define(
    "all-attributes",
    "全属性",
    "All attributes",
    "点",
    "同时提供力量、敏捷和智力。",
    "同一数值分别作用于三项属性；不要把全属性与单独属性贡献重复相加。",
  ),
  define(
    "evasion",
    "闪避",
    "Evasion",
    "%",
    "使普通攻击未命中的概率。",
    "必中、致盲和多个闪避来源的交互需要另行处理；面板百分比不是对所有伤害的减免。",
  ),
  define(
    "lifesteal",
    "吸血",
    "Lifesteal",
    "%",
    "根据普通攻击造成的伤害回复生命。",
    "区别于技能吸血和生命恢复；目标类型、攻击效果、吸血增强与治疗限制可能改变结果。",
  ),
  define(
    "spell-lifesteal",
    "技能吸血",
    "Spell lifesteal",
    "%",
    "根据符合条件的技能伤害回复生命。",
    "哪些伤害可吸血、对英雄与非英雄的比例均需按来源核对。例如巫毒面具的同版备注排除了纯粹伤害与反弹伤害。",
  ),
  define(
    "status-resistance",
    "状态抗性",
    "Status resistance",
    "%",
    "缩短适用负面状态的持续时间。",
    "并非所有效果都受影响；持续施加、光环及特殊技能有例外。减速强度与减速抗性另行区分。",
  ),
  define(
    "slow-resistance",
    "减速抗性",
    "Slow resistance",
    "%",
    "降低适用减速效果的强度。",
    "不等同于状态抗性；不直接说明眩晕时长、减速持续时间或移动速度下限。",
  ),
  define(
    "spell-amplification",
    "技能伤害",
    "Spell damage",
    "%",
    "影响适用技能造成的伤害。",
    "此处关联技能伤害增强参数；治疗增强、目标所受伤害加深及普通攻击增伤不能直接归入同一结算。",
  ),
  define(
    "cooldown-reduction",
    "冷却时间减少",
    "Cooldown reduction",
    "%",
    "减少技能或物品冷却时间的比例。",
    "固定秒数减少、刷新冷却和充能恢复时间属于不同规则；多个来源如何叠加需单独核验。",
  ),
  define(
    "critical-chance",
    "致命一击概率",
    "Critical strike chance",
    "%",
    "普通攻击触发致命一击的概率。",
    "概率与伤害倍率分别记录；伪随机分布、必定触发和多种暴击同时存在的规则需按来源处理。",
  ),
  define(
    "critical-multiplier",
    "致命一击伤害",
    "Critical strike damage",
    "%",
    "致命一击触发时对适用攻击伤害采用的倍率。",
    "例如 200% 表示两倍适用伤害，并非额外增加两倍；哪些附加伤害可参与暴击需另行确认。",
  ),
  define(
    "damage-block",
    "伤害格挡",
    "Damage block",
    "点",
    "从符合条件的攻击伤害中抵消一定数值。",
    "近战与远程、触发概率、格挡顺序及多个来源竞争需分别记录；不能当作对所有伤害生效的护盾。",
  ),
  define(
    "health-cost",
    "生命消耗",
    "Health cost",
    "点",
    "施放技能或使用物品需要支付的生命资源。",
    "按最大生命比例支付、能否致死和持续支付需按对象说明处理。",
  ),
  define(
    "charges",
    "充能次数",
    "Charges",
    "次",
    "对象能够储存或当前定义提供的使用次数。",
    "初始充能、最大充能和一次使用消耗分别保留，不能自动视作同一数值。",
  ),
  define(
    "charge-restore-time",
    "充能恢复时间",
    "Charge restore time",
    "秒",
    "恢复一次充能所需的基础时间。",
    "与普通冷却不同；多充能是否依次恢复以及冷却减少的适用性按对象规则处理。",
  ),
  define(
    "duration",
    "持续时间",
    "Duration",
    "秒",
    "对象效果持续的基础时间。",
    "只汇集明确声明为效果时长的字段，不推断所有同名参数；引导、施法动作和充能时间单独处理。",
  ),
  define(
    "damage",
    "伤害",
    "Damage",
    "点",
    "对象定义中的基础伤害数值。",
    "物理、魔法和纯粹类型及各段伤害由对象说明决定；不等于攻击力或技能伤害增强。",
  ),
  define(
    "mana-cost-reduction",
    "魔法消耗降低",
    "Mana cost reduction",
    "%",
    "降低适用技能或物品魔法消耗的比例。",
    "固定消耗减少、百分比消耗和多来源叠加需分别核验。",
  ),
  define(
    "aoe-bonus",
    "作用范围",
    "Area of effect",
    "距离单位",
    "技能或物品效果覆盖的空间范围及其加成。",
    "半径、直径、宽度和全局作用不能互换；施法距离独立计算，是否受范围加成影响由来源条件决定。",
  ),
  define(
    "healing-amplification",
    "治疗增强",
    "Healing amplification",
    "%",
    "增强适用治疗效果的数值。",
    "施加治疗与受到治疗的修正分开；不自动推广到生命恢复或吸血。",
  ),
  define(
    "restoration-amplification",
    "生命回复",
    "Health restoration",
    "%",
    "来源中对生命回复效果的增强。",
    "覆盖治疗、恢复或吸血的范围依对象说明，不能把所有恢复机制默认套用相同倍率。",
  ),
  define(
    "debuff-amplification",
    "负面状态持续时间",
    "Debuff duration",
    "%",
    "改变适用负面状态持续时间的修正。",
    "与状态抗性、减速强度及基础持续时间分开；例外和叠加需要同版核验。",
  ),
  define(
    "primary-attribute",
    "主属性",
    "Primary attribute",
    "依来源说明",
    "英雄定义的主要属性类型。",
    "取值为力量、敏捷、智力或全才；对应的攻击力换算由当前版本机制决定。",
  ),
  define(
    "item-cost",
    "价格",
    "Cost",
    "金币",
    "物品来源定义中的基础价格。",
    "出售价格、配方总价、折扣与购买资格另有规则；零价格不代表能够免费购买。",
  ),
  ...ENUM_ATTRIBUTES,
];
export const HERO_ATTRIBUTE_FIELDS: Record<string, string> = {
  base_strength: "strength",
  strength_gain: "strength",
  base_agility: "agility",
  agility_gain: "agility",
  base_intelligence: "intelligence",
  intelligence_gain: "intelligence",
  base_health: "health",
  base_mana: "mana",
  base_health_regen: "health-regen",
  base_mana_regen: "mana-regen",
  base_armor: "armor",
  magic_resistance: "magic-resistance",
  base_attack_damage_min: "attack-damage",
  base_attack_damage_max: "attack-damage",
  base_attack_speed: "attack-speed",
  attack_rate: "attack-interval",
  attack_animation_point: "attack-point",
  attack_range: "attack-range",
  projectile_speed: "projectile-speed",
  movement_speed: "movement-speed",
  turn_rate: "turn-rate",
  day_vision: "day-vision",
  night_vision: "night-vision",
};
export const UNIT_ATTRIBUTE_FIELDS: Record<string, string> = {
  StatusHealth: "health",
  StatusHealthRegen: "health-regen",
  StatusMana: "mana",
  StatusManaRegen: "mana-regen",
  AttackDamageMin: "attack-damage",
  AttackDamageMax: "attack-damage",
  ArmorPhysical: "armor",
  MagicalResistance: "magic-resistance",
  MovementSpeed: "movement-speed",
  AttackRange: "attack-range",
  AttackRate: "attack-interval",
  BaseAttackSpeed: "attack-speed",
  BountyGoldMin: "gold-bounty",
  BountyGoldMax: "gold-bounty",
  BountyXP: "experience-bounty",
  VisionDaytimeRange: "day-vision",
  VisionNighttimeRange: "night-vision",
  Level: "level",
  AttributeBaseStrength: "strength",
  AttributeStrengthGain: "strength",
  AttributeBaseAgility: "agility",
  AttributeAgilityGain: "agility",
  AttributeBaseIntelligence: "intelligence",
  AttributeIntelligenceGain: "intelligence",
  AttackAnimationPoint: "attack-point",
  ProjectileSpeed: "projectile-speed",
  MovementTurnRate: "turn-rate",
  TurnRate: "turn-rate",
};
const aliases: Record<string, string> = {
  bonus_all_stats: "all-attributes",
  bonus_night_vision: "night-vision",
  night_vision_bonus: "night-vision",
  consumed_bonus_night_vision: "night-vision",
  bonus_day_vision: "day-vision",
  evasion: "evasion",
  bonus_evasion: "evasion",
  lifesteal_percent: "lifesteal",
  lifesteal_aura: "lifesteal",
  spell_lifesteal: "spell-lifesteal",
  status_resistance: "status-resistance",
  slow_resistance: "slow-resistance",
  slow_resist: "slow-resistance",
  bonus_slow_resistance: "slow-resistance",
  spell_amp: "spell-amplification",
  bonus_spell_amp: "spell-amplification",
  bonus_cooldown: "cooldown-reduction",
  crit_chance: "critical-chance",
  crit_multiplier: "critical-multiplier",
  damage_block_melee: "damage-block",
  damage_block_ranged: "damage-block",
  block_damage_melee: "damage-block",
  block_damage_ranged: "damage-block",
  magic_resistance: "magic-resistance",
  magic_resist: "magic-resistance",
  bonus_magic_resistance: "magic-resistance",
  bonus_spell_resist: "magic-resistance",

  armor: "armor",
  bonus_armor: "armor",
  armor_reduction: "armor",
  bonus_strength: "strength",
  bonus_agility: "agility",
  bonus_intellect: "intelligence",
  bonus_intelligence: "intelligence",
  bonus_health: "health",
  bonus_mana: "mana",
  bonus_health_regen: "health-regen",
  health_regen: "health-regen",
  bonus_mana_regen: "mana-regen",
  mana_regen: "mana-regen",
  bonus_attack_speed: "attack-speed",
  attack_speed: "attack-speed",
  bonus_attack_range: "attack-range",
  attack_range_bonus: "attack-range",
  bonus_movement_speed: "movement-speed",
  movement_speed: "movement-speed",
  bonus_damage: "attack-damage",
  abilitycooldown: "cooldown",
  abilitymanacost: "mana-cost",
  abilitycastrange: "cast-range",
  abilitycastpoint: "cast-point",
  abilitychanneltime: "channel-time",
  abilityhealthcost: "health-cost",
  abilitycharges: "charges",
  initialabilitycharges: "charges",
  iteminitialcharges: "charges",
  abilitychargerestoretime: "charge-restore-time",
  abilityduration: "duration",
  abilitydamage: "damage",
  itemcost: "item-cost",
  manacost_reduction: "mana-cost-reduction",
  mana_cost_reduction: "mana-cost-reduction",
  aoe_bonus: "aoe-bonus",
  bonus_aoe: "aoe-bonus",
  healing_amp: "healing-amplification",
  restoration_amp: "restoration-amplification",
  debuff_amp: "debuff-amplification",
  status_resist: "status-resistance",
};
const officialVariableAttributes: Record<string, string> = {
  health: "health",
  mana: "mana",
  armor: "armor",
  damage: "attack-damage",
  str: "strength",
  agi: "agility",
  int: "intelligence",
  all: "all-attributes",
  attack: "attack-speed",
  attack_pct: "attack-speed",
  hp_regen: "health-regen",
  lifesteal: "lifesteal",
  mana_regen: "mana-regen",
  mana_regen_aura: "mana-regen",
  spell_amp: "spell-amplification",
  debuff_amp: "debuff-amplification",
  move_speed: "movement-speed",
  exclusive_movespeed: "movement-speed",
  evasion: "evasion",
  spell_resist: "magic-resistance",
  spell_lifesteal: "spell-lifesteal",
  attack_range: "attack-range",
  attack_range_melee: "attack-range",
  attack_range_all: "attack-range",
  cast_range: "cast-range",
  status_resist: "status-resistance",
  projectile_speed: "projectile-speed",
  manacost_reduction: "mana-cost-reduction",
  cooldown_reduction: "cooldown-reduction",
  max_mana_percentage: "mana",
  slow_resistance: "slow-resistance",
  aoe_bonus: "aoe-bonus",
  healing_amp: "healing-amplification",
  restoration_amp: "restoration-amplification",
};
export function attributeId(
  kind: AttributeOwnerKind,
  owner: string,
  field: string,
  labelToken?: string,
): string {
  const variable =
    labelToken &&
    /^[+%]?\$([a-z_]+)[:：]?$/i.exec(labelToken.trim())?.[1].toLowerCase();
  if (variable && officialVariableAttributes[variable])
    return officialVariableAttributes[variable];
  const enumId = ENUM_ATTRIBUTE_FIELDS[field];
  if (enumId) return enumId;
  const mapped =
    kind === "hero"
      ? (HERO_ATTRIBUTE_FIELDS[field] ?? UNIT_ATTRIBUTE_FIELDS[field])
      : kind === "unit"
        ? UNIT_ATTRIBUTE_FIELDS[field]
        : kind === "ability" && field.toLowerCase() === "bonus_damage"
          ? undefined
          : aliases[field.toLowerCase()];
  return mapped ?? `${kind}~${owner}~${field.toLowerCase()}`;
}
export function attributeDefinition(id: string) {
  return ATTRIBUTES.find((a) => a.id === id);
}
export interface AttributeRelation {
  attributeId: string;
  valueType?: "number" | "enum" | "flags";
  kind: AttributeOwnerKind;
  owner: string;
  href: string;
  zh: string;
  en: string;
  field: string;
  labelZh: string;
  labelEn: string;
  labelNote?: { zh: string; en: string };
  value: string;
  descriptionZh: string;
  descriptionEn: string;
  sourcePath: string;
  sourceLine?: number;
  modifiers?: unknown;
}
export interface AttributeEntry extends AttributeDefinition {
  relations: AttributeRelation[];
}
export function buildAttributeEntries(
  relations: AttributeRelation[],
  definitions: AttributeDefinition[] = [],
): AttributeEntry[] {
  const entries = new Map<string, AttributeEntry>(
    definitions.map((definition) => [
      definition.id,
      { ...definition, relations: [] },
    ]),
  );
  for (const relation of relations) {
    let entry = entries.get(relation.attributeId);
    if (!entry) {
      const known = attributeDefinition(relation.attributeId);
      entry = {
        ...(known ??
          define(
            relation.attributeId,
            relation.labelZh,
            relation.labelEn,
            "依来源说明",
            "该参数由所属对象定义，具体作用见下方同版本效果说明。",
            "仅在该对象内定义；同名字段不自动视为相同机制。没有可靠说明的参数保留待核验，不推断单位、加成方向或叠加公式。",
          )),
        relations: [],
      };
      if (!known && relation.valueType && relation.valueType !== "number") {
        entry.valueType = relation.valueType;
        entry.enumValues = [];
        entry.unit = relation.valueType === "flags" ? "多选标记" : "枚举值";
      }
      entries.set(entry.id, entry);
    }
    if (relation.valueType === "flags" && entry.valueType === "enum")
      entry.valueType = "flags";
    entry.relations.push(relation);
  }
  for (const entry of entries.values()) {
    if (entry.id === "primary-attribute") {
      entry.valueType = "enum";
      entry.unit = "枚举值";
      entry.enumValues = PRIMARY_ATTRIBUTE_VALUES;
    }
    if (entry.valueType === "enum" || entry.valueType === "flags") {
      const values = new Map(
        (entry.enumValues ?? []).map((value) => [value.value, value]),
      );
      for (const relation of entry.relations)
        for (const raw of relation.value.split("|")) {
          const value = raw.trim();
          if (value && !values.has(value))
            values.set(value, {
              value,
              zh: value,
              en: value,
              summary: "枚举含义待核验",
            });
        }
      entry.enumValues = [...values.values()];
    }
  }
  const ranks = new Map(ATTRIBUTES.map((entry, index) => [entry.id, index]));
  ["strength", "agility", "intelligence"].forEach((id, index) =>
    ranks.set(id, index - 3),
  );
  return [...entries.values()].sort(
    (a, b) =>
      (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity) ||
      a.id.localeCompare(b.id),
  );
}

export interface AttributeSummary extends Pick<
  AttributeDefinition,
  "id" | "zh" | "en" | "summary"
> {
  count: number;
  owner: string;
  kinds: string[];
  searchText: string;
}
