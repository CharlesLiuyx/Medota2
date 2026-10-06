export const UNIT_CATEGORIES = {
  lane: "兵线单位",
  neutral: "中立生物",
  ancient: "远古生物",
  building: "建筑",
  boss: "首领",
  ward: "守卫",
  courier: "信使",
  summon: "召唤与其他",
  event: "活动单位",
  helper: "辅助与模板",
} as const;
export type UnitCategory = keyof typeof UNIT_CATEGORIES;
export interface UnitDefinition {
  internalName: string;
  model?: string | null;
  summonAbility?: string | null;
  zhName: string;
  enName: string;
  category: UnitCategory;
  team: string;
  variant: string;
  attack: string;
  stats: Record<string, string | null>;
  abilities: string[];
}
export const UNIT_STATS = {
  StatusHealth: "生命值",
  StatusHealthRegen: "生命恢复",
  StatusMana: "魔法值",
  StatusManaRegen: "魔法恢复",
  AttackDamageMin: "最低攻击力",
  AttackDamageMax: "最高攻击力",
  ArmorPhysical: "护甲",
  MagicalResistance: "魔法抗性（%）",
  MovementSpeed: "移动速度",
  AttackRange: "攻击距离",
  AttackRate: "基础攻击间隔（秒）",
  BaseAttackSpeed: "基础攻击速度",
  BountyGoldMin: "最低金钱奖励",
  BountyGoldMax: "最高金钱奖励",
  BountyXP: "经验奖励",
  VisionDaytimeRange: "白天视野",
  VisionNighttimeRange: "夜晚视野",
  Level: "等级",
} as const;
