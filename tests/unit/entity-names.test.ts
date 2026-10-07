import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import supplement from "@/data/entity-names/supplement.v1.json";
import {
  nameSupplementProvenance,
  supplementEntityNames,
} from "@/domain/entity-names";
import { adaptItems } from "@/importers/dota-vpk/item-adapter";
import { adaptUnits, unitTokens } from "@/importers/dota-vpk/unit-adapter";

const commit = "f4c45719314754567cb4ef4fe343bbc790a311f4";

it("recovers suffixed Valve names without discarding their raw keys or overriding an explicit name", () => {
  const tokens = unitTokens(
    '"lang" { "Tokens" { "DOTA_Tooltip_Ability_item_poor_mans_shield:n" "穷鬼盾" "DOTA_Tooltip_Ability_item_blink:n" "旧名" "DOTA_Tooltip_Ability_item_blink" "闪烁匕首" } }',
  );
  expect(tokens.dota_tooltip_ability_item_poor_mans_shield).toBe("穷鬼盾");
  expect(tokens["dota_tooltip_ability_item_poor_mans_shield:n"]).toBe("穷鬼盾");
  expect(tokens.dota_tooltip_ability_item_blink).toBe("闪烁匕首");
});

it("fills reviewed names on both pinned releases, preserves current text and keeps unknown versions unchanged", () => {
  for (const sourceCommit of supplement.appliesToSourceCommits) {
    const primary = { dota_tooltip_ability_dazzle_weave: "同版本原名" };
    const zh = supplementEntityNames(primary, sourceCommit, "zh-CN");
    const en = supplementEntityNames({}, sourceCommit, "en");
    expect(zh.dota_tooltip_ability_dazzle_weave).toBe("同版本原名");
    expect(zh.dota_tooltip_facet_techies_atk_range).toBe("斯奎的瞄准镜");
    expect(en.dota_tooltip_facet_techies_atk_range).toBe("Squee's Scope");
    expect(zh.npc_dota_target_dummy).toBe("测试标靶（用途名）");
    expect(en.npc_dota_target_dummy).toBe("Target Dummy (descriptive)");
    expect(zh.dota_tooltip_ability_generic_hidden).toBe("隐藏技能槽（用途名）");
    expect(zh.dota_tooltip_ability_unknown_future_spell).toBeUndefined();
    expect(primary).toEqual({
      dota_tooltip_ability_dazzle_weave: "同版本原名",
    });
    expect(nameSupplementProvenance(sourceCommit)?.content_sha256).toBe(
      supplement.contentSha256,
    );
  }
  expect(supplementEntityNames({}, "a".repeat(40), "en")).toEqual({});
  expect(nameSupplementProvenance("a".repeat(40))).toBeNull();
});

it("resolves recipe names and unit format strings while retaining current values and truly unknown names", () => {
  const items = adaptItems(
    '"DOTAAbilities" { "item_poor_mans_shield" { "ItemCost" "123" } "item_recipe_poor_mans_shield" { "ItemRecipe" "1" "ItemResult" "item_poor_mans_shield" } }',
    supplementEntityNames({}, commit, "zh-CN"),
    supplementEntityNames({}, commit, "en"),
  ).items;
  expect(items[0]).toMatchObject({ zhName: "穷鬼盾", cost: "123" });
  expect(items[1]).toMatchObject({
    zhName: "穷鬼盾图纸",
    enName: "Poor Man's Shield Recipe",
  });
  const units = adaptUnits(
    '"DOTAUnits" { "npc_dota_units_base" { "StatusHealth" "150" } "npc_dota_neutral_mud_golem_split_doom" { "StatusHealth" "300" } "unknown_unit" {} }',
    supplementEntityNames(
      { npc_dota_neutral_mud_golem_split_doom: "小%s1" },
      commit,
      "zh-CN",
    ),
    supplementEntityNames({}, commit, "en"),
  ).units;
  expect(
    units.find(
      (u) => u.internalName === "npc_dota_neutral_mud_golem_split_doom",
    ),
  ).toMatchObject({
    zhName: "末日使者碎片（用途名）",
    stats: { StatusHealth: "300" },
  });
  expect(units.find((u) => u.internalName === "unknown_unit")?.zhName).toBe(
    "名称待补充",
  );
});

it("keeps the complete reviewed inventory auditable with valid source references and a matching content digest", () => {
  const { entries, sources } = supplement;
  expect(
    createHash("sha256")
      .update(JSON.stringify({ sources, entries }))
      .digest("hex"),
  ).toBe(supplement.contentSha256);
  expect(new Set(entries.map((e) => `${e.entity}:${e.key}`)).size).toBe(530);
  expect(
    Object.fromEntries(
      ["item", "unit", "ability", "facet"].map((entity) => [
        entity,
        entries.filter((e) => e.entity === entity).length,
      ]),
    ),
  ).toEqual({ item: 76, unit: 123, ability: 281, facet: 50 });
  const sourceIds = new Set(sources.map((source) => source.id));
  for (const source of sources) {
    expect(source.source_commit).toMatch(/^[a-f0-9]{40}$/u);
    expect(source.raw_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(source.url).toBe(
      `https://raw.githubusercontent.com/spirit-bear-productions/dota_vpk_updates/${source.source_commit}/${source.source_path}`,
    );
  }
  for (const entry of entries) {
    expect(entry.names.zh).not.toMatch(/待补充|_[a-z]|<[^>]+>/u);
    expect(entry.names.en).not.toMatch(/unavailable|_[a-z]|<[^>]+>/iu);
    expect(entry.evidence.some((e) => "key" in e && e.key === entry.key)).toBe(
      true,
    );
    for (const evidence of entry.evidence)
      expect(sourceIds.has(evidence.source)).toBe(true);
  }
});
