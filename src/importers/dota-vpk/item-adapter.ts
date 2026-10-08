import { attributeDefinition, attributeId } from "@/domain/attributes";
import {
  parseKeyValues,
  type KeyValuesObject,
} from "@/importers/keyvalues/parser";
import {
  behaviorLabels,
  gameText,
  numbers,
  valueLabel,
} from "@/presentation/dota";
import type { ItemDefinition } from "@/domain/items";
import { itemParameterLabel } from "@/domain/item-parameter-labels";

export const ITEM_ADAPTER_VERSION = "vpk-items-v4";
const scalar = (object: KeyValuesObject, key: string) => {
  const value = object.entries.findLast((entry) => entry.key === key)?.value;
  return typeof value === "string" ? value : undefined;
};
const object = (root: KeyValuesObject, key: string) => {
  const value = root.entries.findLast((entry) => entry.key === key)?.value;
  return typeof value === "object" ? value : undefined;
};
export function adaptItems(
  text: string,
  zh: Record<string, string>,
  en: Record<string, string>,
  sourceCommit?: string,
) {
  const root = object(parseKeyValues(text), "DOTAAbilities");
  if (!root) throw new Error("Missing item DOTAAbilities");
  const description = (
    value: string | undefined,
    values: Record<string, string>,
    locale: "zh-CN" | "en",
  ) =>
    value ? gameText(value.replace(/<\/h[1-6]>/giu, "\n"), values, locale) : "";
  const seen = new Set<string>();
  const items: ItemDefinition[] = [];
  for (const entry of root.entries) {
    if (!entry.key.startsWith("item_")) continue;
    if (seen.has(entry.key))
      throw new Error(`Duplicate item identity: ${entry.key}`);
    seen.add(entry.key);
    if (typeof entry.value === "string")
      throw new Error(`Invalid item definition: ${entry.key}`);
    const fields = entry.value;
    const token = `dota_tooltip_ability_${entry.key}`.toLowerCase();
    const recipe = scalar(fields, "ItemRecipe") === "1";
    const result = scalar(fields, "ItemResult") || null;
    const name = (
      tokens: Record<string, string>,
      fallback: Record<string, string>,
      english: boolean,
    ) => {
      const direct = tokens[token] || fallback[token];
      if (direct) return gameText(direct);
      const base =
        result &&
        (tokens[`dota_tooltip_ability_${result}`] ||
          fallback[`dota_tooltip_ability_${result}`]);
      return recipe && base
        ? `${gameText(base)}${english ? " Recipe" : "图纸"}`
        : english
          ? "Name unavailable"
          : "名称待补充";
    };
    const values: Record<string, string> = {};
    for (const value of object(fields, "AbilityValues")?.entries ?? []) {
      const raw =
        typeof value.value === "string"
          ? value.value
          : scalar(value.value, "value");
      if (raw !== undefined) values[value.key.toLowerCase()] = numbers(raw);
    }
    // Older snapshots use numbered AbilitySpecial blocks.
    for (const block of object(fields, "AbilitySpecial")?.entries ?? []) {
      if (typeof block.value === "string") continue;
      for (const value of block.value.entries) {
        if (
          value.key !== "var_type" &&
          typeof value.value === "string" &&
          values[value.key.toLowerCase()] === undefined
        )
          values[value.key.toLowerCase()] = numbers(value.value);
      }
    }
    const stats: ItemDefinition["stats"] = [];
    for (const [key, zhLabel, enLabel] of [
      ["AbilityCooldown", "冷却时间（秒）", "Cooldown (s)"],
      ["AbilityManaCost", "魔法消耗", "Mana cost"],
      ["AbilityCastRange", "施法距离", "Cast range"],
    ]) {
      const raw = values[key.toLowerCase()] ?? scalar(fields, key);
      if (raw !== undefined) {
        const source =
          object(fields, "AbilityValues")?.entries.find(
            (e) => e.key.toLowerCase() === key.toLowerCase(),
          ) ?? fields.entries.find((e) => e.key === key);
        values[key.toLowerCase()] ??= numbers(raw);
        stats.push({
          key: key.toLowerCase(),
          sourceLine: source?.line,
          modifiers:
            typeof source?.value === "object" ? source.value : undefined,
          zh: zhLabel,
          en: enLabel,
          value: values[key.toLowerCase()],
        });
      }
    }
    for (const [key, value] of Object.entries(values)) {
      if (
        ["abilitycooldown", "abilitymanacost", "abilitycastrange"].includes(key)
      )
        continue;
      const zhToken = zh[`${token}_${key}`];
      const enToken = en[`${token}_${key}`];
      const supplement = itemParameterLabel(sourceCommit, entry.key, key);
      const known = attributeDefinition(
        attributeId("item", entry.key, key, zhToken || enToken),
      );
      const sourceZhLabel = valueLabel(key, zhToken, "zh-CN", zh) || known?.zh;
      const sourceEnLabel = valueLabel(key, enToken, "en", en) || known?.en;
      const label = sourceZhLabel || supplement?.zh || sourceEnLabel;
      const source = object(fields, "AbilityValues")?.entries.find(
        (e) => e.key.toLowerCase() === key,
      );
      stats.push({
        key,
        labelToken: zhToken || enToken,
        labelNote:
          !sourceZhLabel || !sourceEnLabel ? supplement?.note : undefined,
        sourceLine: source?.line,
        modifiers: typeof source?.value === "object" ? source.value : undefined,
        zh: label === key ? (known?.zh ?? label) : label || "未命名参数",
        en: sourceEnLabel || supplement?.en || label || "Unnamed parameter",
        value:
          ((zhToken || enToken)?.startsWith("%") ||
            (!(zhToken || enToken) && supplement?.unit === "%")) &&
          value !== "未提供"
            ? `${value}%`
            : value,
      });
    }
    const cost = scalar(fields, "ItemCost");
    items.push({
      internalName: entry.key,
      zhName: name(zh, en, false),
      enName: name(en, zh, true),
      nameLocales: {
        zh:
          zh[token] ||
          (recipe && result && zh[`dota_tooltip_ability_${result}`])
            ? "zh-CN"
            : en[token] ||
                (recipe && result && en[`dota_tooltip_ability_${result}`])
              ? "en"
              : null,
        en:
          en[token] ||
          (recipe && result && en[`dota_tooltip_ability_${result}`])
            ? "en"
            : zh[token] ||
                (recipe && result && zh[`dota_tooltip_ability_${result}`])
              ? "zh-CN"
              : null,
      },
      descriptionLocales: {
        zh: zh[`${token}_description`]
          ? "zh-CN"
          : en[`${token}_description`]
            ? "en"
            : null,
        en: en[`${token}_description`]
          ? "en"
          : zh[`${token}_description`]
            ? "zh-CN"
            : null,
      },
      category: recipe
        ? "recipe"
        : scalar(fields, "ItemIsNeutralPassiveDrop") === "1"
          ? "enchantment"
          : scalar(fields, "ItemIsNeutralActiveDrop") === "1" ||
              scalar(fields, "ItemIsNeutralDrop") === "1"
            ? "neutral"
            : scalar(fields, "ItemPurchasable") === "0"
              ? "other"
              : "equipment",
      cost: cost && /^\d+(?:\.\d+)?$/.test(cost) ? String(Number(cost)) : null,
      behavior: behaviorLabels(scalar(fields, "AbilityBehavior")),
      descriptions: {
        zh: description(
          zh[`${token}_description`] || en[`${token}_description`],
          values,
          "zh-CN",
        ),
        en: description(
          en[`${token}_description`] || zh[`${token}_description`],
          values,
          "en",
        ),
      },
      stats,
      result,
      requirements: (object(fields, "ItemRequirements")?.entries ?? []).map(
        (requirement) => {
          if (typeof requirement.value !== "string")
            throw new Error(`Invalid item requirements: ${entry.key}`);
          return requirement.value
            .split(";")
            .map((key) => key.trim())
            .filter(Boolean);
        },
      ),
    });
  }
  if (!items.length) throw new Error("Empty item definitions");
  return { items, raw: root };
}
