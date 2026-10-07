import { describe, expect, it } from "vitest";
import {
  changeValue,
  matchesPatchBoundary,
  readableChanges,
  type ChangeDictionary,
} from "@/presentation/entity-changes";
import type { EntityVersionChange } from "@/domain/entity-version-diff";
import patch from "@/data/patch-notes/7.41f.json";
const names: ChangeDictionary = {
  heroes: { bane: { key: "bane", name: "祸乱之源" } },
  heroIds: { 3: "bane" },
  abilities: {
    mana_break: {
      key: "mana_break",
      name: "法力损毁",
      valueRows: {
        percent_damage_per_burn: {
          value_key: "percent_damage_per_burn",
          level_values: ["65"],
          modifiers: [{ key: "display_type", value: "kDebuffPercentage" }],
        },
      },
    },
  },
};
const change = (
  path: string,
  before: unknown,
  after: unknown,
  extra: Partial<EntityVersionChange> = {},
): EntityVersionChange => ({
  entityType: "ability",
  entityKey: "mana_break",
  path,
  category: "property",
  operation: "modified",
  before: { status: "value", value: before },
  after: { status: "value", value: after },
  beforeSources: [],
  afterSources: [],
  review: null,
  ...extra,
});
describe("player-facing endpoint changes", () => {
  it("names Bane's armor and collapses the two stored forms of Mana Break's percentage without losing evidence", () => {
    const input = [
      change("/base_armor", "1.000000", "0.000000", {
        entityType: "hero",
        entityKey: "bane",
      }),
      change("/values/0:percent_damage_per_burn/level_values", ["60"], ["65"]),
      change("/values/0:percent_damage_per_burn/scalar_value", "60", "65"),
    ];
    const view = readableChanges(input, names);
    expect(
      view.rows.map((r) => [r.subject.name, r.label, r.before, r.after]),
    ).toEqual([
      ["祸乱之源", "基础护甲", "1", "0"],
      ["法力损毁", "损毁魔法值伤害系数", "60%", "65%"],
    ]);
    expect(view.rows[1].evidence).toHaveLength(2);
    expect(view.technical).toEqual([]);
  });
  it("explains a changed growth interval without claiming a full engine formula", () => {
    const before = [
      { key: "hero_levelup", value: "+1" },
      { key: "levelup_interval", value: "4" },
    ];
    const after = [
      { key: "hero_levelup", value: "+1" },
      { key: "levelup_interval", value: "5" },
    ];
    const view = readableChanges(
      [change("/values/3:AbilityCharges/modifiers", before, after)],
      names,
    );
    expect([
      view.rows[0].label,
      view.rows[0].before,
      view.rows[0].after,
    ]).toEqual(["能量点数 · 等级成长", "每4级 +1", "每5级 +1"]);
  });
  it("keeps each skill level, absence, null and zero distinct", () => {
    expect(
      changeValue(
        { status: "value", value: ["20", "19", "18", "17"] },
        undefined,
        "cooldown",
      ),
    ).toBe("20 / 19 / 18 / 17 秒");
    expect([
      changeValue({ status: "absent" }),
      changeValue({ status: "value", value: null }),
      changeValue({ status: "value", value: "0.000" }),
    ]).toEqual(["未设置", "空值", "0"]);
  });
  it("preserves unknown engine behavior as technical evidence rather than inventing a game effect", () => {
    const input = change("/behavior", ["ENGINE_UNKNOWN"], ["ENGINE_OTHER"]);
    const view = readableChanges([input], names);
    expect(view.rows).toEqual([]);
    expect(view.technical).toEqual([input]);
  });
  it("renders each side's localized talent text using that endpoint's values", () => {
    const current = {
      ...names,
      abilities: {
        ...names.abilities,
        mana_break: {
          ...names.abilities.mana_break,
          values: { bonus_damage: "35" },
        },
      },
    };
    const previous = {
      ...names,
      abilities: {
        ...names.abilities,
        mana_break: {
          ...names.abilities.mana_break,
          values: { bonus_damage: "25" },
        },
      },
    };
    const c = change(
      "/display_name",
      "+{s:bonus_damage} 伤害",
      "+{s:bonus_damage} 伤害",
      { entityType: "localization", entityKey: "ability:mana_break:zh-CN" },
    );
    const view = readableChanges([c], current, previous);
    expect([view.rows[0].before, view.rows[0].after]).toEqual([
      "+25 伤害",
      "+35 伤害",
    ]);
  });
  it("attaches the official edition only to its reviewed forward source pair", () => {
    const from = { patch: "7.41e", sourceCommit: patch.fromCommit },
      to = { patch: "7.41f", sourceCommit: patch.toCommit };
    expect(matchesPatchBoundary(patch, from, to)).toBe(true);
    expect(matchesPatchBoundary(patch, to, from)).toBe(false);
    expect(matchesPatchBoundary(patch, to, to)).toBe(false);
    expect(matchesPatchBoundary(patch, { ...from, patch: "7.41d" }, to)).toBe(
      false,
    );
    expect(
      matchesPatchBoundary(patch, from, { ...to, sourceCommit: "other" }),
    ).toBe(false);
  });
  it("includes all reviewed official subjects and measured item prices with fixed-source evidence", () => {
    expect(patch.heroes).toHaveLength(35);
    expect(patch.items).toHaveLength(17);
    expect(patch.itemChanges).toHaveLength(24);
    expect(patch.itemNames.item_recipe_heart).toBe("恐鳌之心");
    const heart = patch.itemChanges.find(
      (c) => c.entityKey === "item_recipe_heart",
    )!;
    expect([heart.before.value, heart.after.value]).toEqual(["700", "800"]);
    expect(heart.afterSources[0].commit).toBe(patch.toCommit);
  });
});
