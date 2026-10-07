export const ITEM_CATEGORIES = {
  equipment: "装备与消耗品",
  neutral: "中立物品",
  enchantment: "中立附魔",
  recipe: "合成图纸",
  other: "其他物品",
} as const;
export type ItemCategory = keyof typeof ITEM_CATEGORIES;
export interface ItemDefinition {
  internalName: string;
  zhName: string;
  enName: string;
  nameLocales?: { zh: "zh-CN" | "en" | null; en: "zh-CN" | "en" | null };
  category: ItemCategory;
  cost: string | null;
  behavior: string[];
  descriptionLocales?: { zh: "zh-CN" | "en" | null; en: "zh-CN" | "en" | null };
  descriptions: { zh: string; en: string };
  stats: Array<{
    key: string;
    labelToken?: string;
    sourceLine?: number;
    modifiers?: unknown;
    zh: string;
    en: string;
    value: string;
    zhLocale?: "zh-CN" | "en";
    enLocale?: "zh-CN" | "en";
  }>;
  result: string | null;
  requirements: string[][];
}
