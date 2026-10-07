import evidence from "@/data/attributes/evidence.v1.json";
import type { AttributeDefinition } from "./attributes";
const labelTokens: Record<string, string> = {
  armor: "armor",
  strength: "str",
  agility: "agi",
  intelligence: "int",
  health: "health",
  mana: "mana",
  "health-regen": "hp_regen",
  "mana-regen": "mana_regen",
  "attack-damage": "damage",
  "attack-speed": "attack",
  "magic-resistance": "spell_resist",
  "movement-speed": "move_speed",
  "all-attributes": "all",
  evasion: "evasion",
  lifesteal: "lifesteal",
  "spell-lifesteal": "spell_lifesteal",
  "spell-amplification": "spell_amp",
  "slow-resistance": "slow_resistance",
  "cooldown-reduction": "cooldown_reduction",
  "cast-range": "cast_range",
  "mana-cost-reduction": "manacost_reduction",
  "aoe-bonus": "aoe_bonus",
  "healing-amplification": "healing_amp",
  "restoration-amplification": "restoration_amp",
  "debuff-amplification": "debuff_amp",
  "primary-attribute": "primary_attribute",
  "status-resistance": "status_resist",
};
function nameToken(id: string) {
  if (id === "day-vision" || id === "night-vision")
    return `DOTA_Tooltip_ability_special_bonus_${id === "day-vision" ? "day" : "night"}_vision_400`;
  return labelTokens[id]
    ? `dota_ability_variable_${labelTokens[id]}`
    : undefined;
}
const glossary: Record<string, string[]> = {
  armor: ["Damage_Armor"],
  "magic-resistance": ["Damage_MagicResistance"],
  evasion: ["Evasion"],
  "status-resistance": ["StatusResistance"],
  "slow-resistance": ["SlowResistance"],
  cooldown: ["Cooldown"],
  "cooldown-reduction": ["Cooldown"],
  "channel-time": ["Channeled"],
  "cast-point": ["CastAnimation"],
  "critical-chance": ["Advanced_CommonBuffs_CriticalStrike"],
  "critical-multiplier": ["Advanced_CommonBuffs_CriticalStrike"],
  lifesteal: ["Advanced_CommonBuffs_LifeSteal"],
};
export function officialAttributeLabels(commit: string, id: string) {
  const snapshot = evidence.snapshots.find((s) => s.source_commit === commit),
    token = nameToken(id);
  const read = (locale: string) =>
    snapshot?.files
      .filter((f) => f.locale === locale)
      .flatMap((f) => f.tokens)
      .find((t) => t.token === token)
      ?.text.replace(/\+?\{s:value\}/gu, "")
      .replace(/[:：]$/u, "")
      .trim();
  return { zh: read("zh-CN"), en: read("en") };
}
export function attributeEvidence(
  commit: string,
  attribute: AttributeDefinition,
  locale: string,
) {
  const snapshot = evidence.snapshots.find((s) => s.source_commit === commit);
  const file = snapshot?.files.find((f) => f.locale === locale);
  const names = [
    `DOTA_HeroStats_${attribute.token}_Desc`,
    nameToken(attribute.id),
    ...(glossary[attribute.id] ?? []).map(
      (name) => `DOTA_Glossary_${name}_Desc`,
    ),
  ];
  if (["health", "health-regen"].includes(attribute.id))
    names.push("DOTA_HeroStats_Strength_Desc");
  if (["mana", "mana-regen", "magic-resistance"].includes(attribute.id))
    names.push("DOTA_HeroStats_Intelligence_Desc");
  if (["armor", "attack-speed"].includes(attribute.id))
    names.push("DOTA_HeroStats_Agility_Desc");
  if (["strength", "agility", "intelligence"].includes(attribute.id))
    names.push(`DOTA_StatTooltip_${attribute.token}Bonus`);
  if (attribute.id === "spell-lifesteal")
    names.push(
      "DOTA_Tooltip_ability_item_voodoo_mask_Description",
      "DOTA_Tooltip_ability_item_voodoo_mask_Note0",
    );
  if (attribute.id === "lifesteal")
    names.push("DOTA_Tooltip_ability_item_lifesteal_Description");
  if (attribute.id === "cast-backswing")
    names.push("courier_autodeliver.AbilityBehavior");
  if (attribute.id === "dispel-type")
    names.push(
      "DOTA_ToolTip_Dispellable_Yes_Strong_2",
      "DOTA_ToolTip_Dispellable_Yes_Soft_2",
      "DOTA_ToolTip_Dispellable_No_2",
    );
  const tokens =
    snapshot?.files
      .filter((f) => f.locale === locale)
      .flatMap((f) =>
        f.tokens
          .filter((t) => names.includes(t.token))
          .map((t) => ({
            ...t,
            source_path: f.source_path,
            raw_sha256: f.raw_sha256,
          })),
      ) ?? [];
  return { snapshot, file, tokens };
}
export const reviewedMechanicsCommit = (commit: string) =>
  evidence.snapshots.some((s) => s.source_commit === commit);
export function attributeFormula(
  id: string,
  commit: string,
): { expression: string; basis: string; note: string; url?: string } | null {
  if (!reviewedMechanicsCommit(commit)) return null;
  const formulas: Record<string, string> = {
    strength: "ΔHealth = 22 × ΔSTR; ΔHealthRegen = 0.1 × ΔSTR",
    agility: "ΔArmor = 0.16 × ΔAGI; ΔAttackSpeed = 1 × ΔAGI",
    intelligence:
      "ΔMana = 12 × ΔINT; ΔManaRegen = 0.05 × ΔINT; ΔBaseMagicResistance = 0.1 × ΔINT (percentage points)",
    health: "Health = BaseHealth + 22 × STR + FlatHealthBonus",
    "health-regen":
      "HealthRegen = BaseHealthRegen + 0.1 × STR + FlatHealthRegen",
    mana: "Mana = BaseMana + 12 × INT + FlatManaBonus",
    "mana-regen": "ManaRegen = BaseManaRegen + 0.05 × INT + FlatManaRegen",
  };
  if (formulas[id])
    return {
      expression: formulas[id],
      basis: "VPK 面板说明推导",
      note: "仅表示基础贡献，未计入百分比增幅、特殊技能、天赋、命石或覆盖规则。面板说明是文本证据，尚未通过同版本引擎实验复核。",
    };
  const definitions: Record<string, string> = {
    "all-attributes": "ΔSTR = ΔAGI = ΔINT = AllAttributeBonus",
    "magic-resistance":
      "MagicalDamageTaken = MagicalDamage × (1 − EffectiveMagicResistance)",
    "status-resistance":
      "Duration = BaseDuration × (1 − EffectiveStatusResistance)",
    "slow-resistance":
      "SlowStrength = OriginalSlowStrength × (1 − EffectiveSlowResistance)",
    evasion: "HitProbability = 1 − EffectiveEvasion",
    lifesteal: "HealthRestored = EligibleAttackDamageDealt × LifestealRatio",
    "critical-chance":
      "ExpectedMultiplier = 1 + p × (m − 1); p = chance / 100; m = criticalDamagePercent / 100",
    "critical-multiplier":
      "CriticalDamage = EligibleAttackDamage × criticalDamagePercent / 100",
    "cooldown-reduction":
      "Cooldown = BaseCooldown × (1 − EffectiveCooldownReduction)",
  };
  if (definitions[id])
    return {
      expression: definitions[id],
      basis: "按定义换算",
      note: "仅说明单个有效比例的作用；不包含多来源叠加、触发顺序、特殊技能与目标例外。",
    };
  if (id === "armor")
    return {
      expression:
        "R = 0.06 × A / (1 + 0.06 × |A|); DamageTaken = PhysicalDamage × (1 − R)",
      basis: "社区机制资料，待引擎复核",
      note: "A 为总护甲，R 为减伤比例。A 为负时 R 为负，表示增伤。此式仅计算护甲环节，忽略伤害格挡、攻击/防御类型及其他修正；物品上的 7 点护甲不等于 7% 减伤。",
      url: "https://liquipedia.net/dota2/Armor",
    };
  if (id === "attack-speed" || id === "attack-interval")
    return {
      expression:
        "AttackInterval = BAT × 100 / AS; AttacksPerSecond = AS / (100 × BAT)",
      basis: "社区机制资料，待引擎复核",
      note: "AS 是经过上下限处理的总攻击速度，BAT 是基础攻击间隔。普通规则常见范围为 20–700；特殊技能、引擎步长和 HUD 显示换算仍需单独核验。",
      url: "https://liquipedia.net/dota2/Attack_Speed",
    };
  return null;
}
export function physicalDamageMultiplier(armor: number): number {
  if (!Number.isFinite(armor)) throw new Error("Armor must be finite");
  return 1 - (0.06 * armor) / (1 + 0.06 * Math.abs(armor));
}
export function attackInterval(bat: number, speed: number): number {
  if (
    !Number.isFinite(bat) ||
    !Number.isFinite(speed) ||
    bat <= 0 ||
    speed <= 0
  )
    throw new Error(
      "BAT and effective attack speed must be positive finite numbers",
    );
  return (bat * 100) / speed;
}
