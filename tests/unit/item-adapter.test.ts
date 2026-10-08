import { expect, it } from "vitest";
import { adaptItems } from "@/importers/dota-vpk/item-adapter";
import { withRelease } from "@/domain/releases";
import { createHash } from "node:crypto";
import parameterResource from "@/data/item-parameters/supplement.v1.json";
import { itemParameterLabel } from "@/domain/item-parameter-labels";

it("keeps reviewed parameter names bound to complete, traceable versioned evidence", () => {
  expect(
    createHash("sha256")
      .update(
        JSON.stringify({
          parameters: parameterResource.parameters,
          snapshots: parameterResource.snapshots,
        }),
      )
      .digest("hex"),
  ).toBe(parameterResource.contentSha256);
  for (const snapshot of parameterResource.snapshots) {
    expect(Object.keys(snapshot.evidence)).toHaveLength(snapshot.missingBefore);
    for (const [id, evidence] of Object.entries(snapshot.evidence)) {
      const [owner, field] = id.split(".");
      const label = itemParameterLabel(snapshot.source_commit, owner, field);
      expect(label?.zh).toMatch(/[\u4e00-\u9fff]/u);
      expect(label?.en).toMatch(/[a-z]/i);
      expect(evidence.definitionLine).toBeGreaterThan(0);
    }
  }
});
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

it("restores reviewed item parameter labels, units and owner-specific meanings without changing their identities", () => {
  const commit = "f4c45719314754567cb4ef4fe343bbc790a311f4";
  const text = `"DOTAAbilities" {
    "item_javelin" { "AbilityValues" { "bonus_chance" "25" "bonus_chance_damage" "60" } }
    "item_basher" { "AbilityValues" { "bonus_chance_damage" "100" } }
    "item_maelstrom" { "AbilityValues" { "chain_chance" "25" "chain_damage" "110" "chain_strikes" "4" "chain_radius" "650" "chain_delay" "0.25" "chain_cooldown" "0.2" "illusion_multiplier_pct" "100" } }
    "item_ash_legion_shield" { "AbilityValues" { "slow" "20" } }
  }`;
  const items = adaptItems(text, {}, {}, commit).items;
  expect(items[0].stats).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "bonus_chance",
        zh: "穿刺概率",
        en: "Pierce chance",
        value: "25%",
      }),
      expect.objectContaining({
        key: "bonus_chance_damage",
        zh: "穿刺额外魔法伤害",
        value: "60",
      }),
    ]),
  );
  expect(items[1].stats[0]).toMatchObject({
    zh: "重击额外物理伤害",
    value: "100",
  });
  expect(items[2].stats.map((s) => [s.zh, s.value])).toEqual([
    ["连环闪电触发概率", "25%"],
    ["连环闪电魔法伤害", "110"],
    ["连环闪电目标数", "4"],
    ["连环闪电跳跃范围", "650"],
    ["连环闪电跳跃间隔（秒）", "0.25"],
    ["连环闪电触发冷却（秒）", "0.2"],
    ["幻象伤害倍率参数", "100%"],
  ]);
  expect(items[2].stats[4].labelNote?.zh).toContain("待核验");
  // A fixed movement-speed penalty must not become a percentage just because
  // other items use the same field name for a percentage slow.
  expect(items[3].stats[0].value).toBe("20");
  expect(adaptItems(text, {}, {}, "unknown").items[0].stats[0].zh).toBe(
    "未命名参数",
  );
  expect(
    adaptItems(
      text.replaceAll("item_javelin", "item_unreviewed"),
      {},
      {},
      commit,
    ).items[0].stats[0].zh,
  ).toBe("未命名参数");
  const token = "dota_tooltip_ability_item_javelin_bonus_chance";
  expect(
    adaptItems(
      text,
      { [token]: "%官方概率：" },
      { [token]: "%OFFICIAL CHANCE:" },
      commit,
    ).items[0].stats[0],
  ).toMatchObject({ zh: "官方概率", en: "OFFICIAL CHANCE", value: "25%" });
});
