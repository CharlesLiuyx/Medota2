import { expect, it } from "vitest";
import { adaptItems } from "@/importers/dota-vpk/item-adapter";
import { withRelease } from "@/domain/releases";
it("reads prices, nested values, neutral categories and alternative recipes from a synthetic snapshot", () => {
  const text = `"DOTAAbilities" {
    "item_blink" { "ItemCost" "2250" "AbilityCooldown" "15.0" "UnknownFuture" "preserved" "AbilityValues" { "blink_range" { "value" "1200" } "AbilityCooldown" "12.0" } }
    "item_recipe_blink" { "ItemRecipe" "1" "ItemCost" "0" "ItemResult" "item_blink" "ItemRequirements" { "01" "item_a;item_a" "02" "item_b*" } }
    "item_neutral" { "ItemIsNeutralActiveDrop" "1" "ItemPurchasable" "0" }
    "item_enchantment" { "ItemIsNeutralPassiveDrop" "1" }
  }`;
  const { items, raw } = adaptItems(
    text,
    {
      dota_tooltip_ability_item_blink: "闪烁匕首",
      dota_tooltip_ability_item_blink_description:
        "<h1>闪烁</h1>距离%blink_range%，冷却%AbilityCooldown%。",
    },
    { dota_tooltip_ability_item_blink: "Blink Dagger" },
  );
  expect(items[0]).toMatchObject({
    cost: "2250",
    zhName: "闪烁匕首",
    descriptions: { zh: "闪烁\n距离1200，冷却12。" },
  });
  expect(items[0].descriptionLocales).toEqual({ zh: "zh-CN", en: "zh-CN" });
  expect(items[2].descriptions.en).toBe("");
  expect(items[0].stats).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        zh: "冷却时间（秒）",
        en: "Cooldown (s)",
        value: "12",
        key: "abilitycooldown",
      }),
    ]),
  );
  expect(items[1]).toMatchObject({
    category: "recipe",
    cost: "0",
    result: "item_blink",
    zhName: "闪烁匕首图纸",
    requirements: [["item_a", "item_a"], ["item_b*"]],
  });
  expect(items[2].category).toBe("neutral");
  expect(items[3].category).toBe("enchantment");
  expect(JSON.stringify(raw)).toContain("UnknownFuture");
  expect(withRelease("/items/item_blink?lang=en", "c:fixture")).toBe(
    "/items/item_blink?lang=en&release=c%3Afixture",
  );
});
it("rejects duplicate identities and malformed or empty item definitions", () => {
  expect(() =>
    adaptItems('"DOTAAbilities" { "item_a" {} "item_a" {} }', {}, {}),
  ).toThrow("Duplicate item identity");
  expect(() =>
    adaptItems('"DOTAAbilities" { "item_a" "bad" }', {}, {}),
  ).toThrow("Invalid item definition");
  expect(() => adaptItems('"DOTAAbilities" {}', {}, {})).toThrow(
    "Empty item definitions",
  );
});
