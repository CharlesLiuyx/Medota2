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
    labelNote?: { zh: string; en: string };
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

/** Directory transport: source evidence and crafting graph stay in the detail projection. */
export type ItemCatalogRow = Omit<
  ItemDefinition,
  "requirements" | "result" | "stats"
> & {
  stats: Array<
    Omit<ItemDefinition["stats"][number], "sourceLine" | "modifiers">
  >;
};
export function itemCatalogRow(item: ItemDefinition): ItemCatalogRow {
  return {
    internalName: item.internalName,
    zhName: item.zhName,
    enName: item.enName,
    nameLocales: item.nameLocales,
    category: item.category,
    cost: item.cost,
    behavior: item.behavior,
    descriptionLocales: item.descriptionLocales,
    descriptions: item.descriptions,
    stats: item.stats.map((stat) => ({
      key: stat.key,
      labelToken: stat.labelToken,
      labelNote: stat.labelNote,
      zh: stat.zh,
      en: stat.en,
      value: stat.value,
      zhLocale: stat.zhLocale,
      enLocale: stat.enLocale,
    })),
  };
}
