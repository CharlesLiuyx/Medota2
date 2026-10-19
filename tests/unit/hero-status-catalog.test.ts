import { describe, it, expect } from "vitest";
import {
  adaptHeroStatuses,
  type StatusSource,
} from "@/importers/dota-vpk/hero-status-adapter";
import { groupStatusResults } from "@/domain/hero-status-catalog";
import {
  emptyInventory,
  updateInventory,
  projectInventory,
  type InventoryCatalog,
} from "@/domain/hero-inventory";
const commit = "f4c45719314754567cb4ef4fe343bbc790a311f4";
const source: StatusSource = {
  id: "ogre_magi_bloodlust",
  kind: "ability",
  name: "嗜血术",
  enName: "Bloodlust",
  maxLevel: 4,
  providers: [
    {
      id: "ogre",
      kind: "hero",
      name: "食人魔魔法师",
      enName: "Ogre Magi",
      href: "/heroes/ogre_magi",
    },
  ],
  values: [
    {
      field: "bonus_movement_speed",
      values: ["6", "8", "10", "12"],
      name: "移动速度",
      enName: "Move speed",
    },
    {
      field: "bonus_attack_speed",
      values: ["35", "50", "65", "80"],
      name: "攻击速度",
      enName: "Attack speed",
    },
    { field: "duration", values: ["30"], name: "持续时间", enName: "Duration" },
  ],
};
const token = "dota_tooltip_modifier_ogre_magi_bloodlust";
const en = {
  [token]: "Bloodlust",
  [`${token}_description`]: "Movement and attack speed increased.",
};
const zh = {
  [token]: "嗜血术",
  [`${token}_description`]: "提高移动速度和攻击速度。",
};
const catalog = (sources: StatusSource[] = [source]): InventoryCatalog => ({
  items: [],
  neutralTiers: [],
  statuses: adaptHeroStatuses(sources, zh, en, commit),
  supported: true,
  source: {
    repository: "fixture",
    commit,
    path: "fixture",
    clientVersion: "6944",
    adapterVersion: "test",
  },
});
describe("provider status catalog", () => {
  it("applies pinned recipient values by chosen level, deduplicates sources, removes and resets", () => {
    const c = catalog([
      {
        ...source,
        providers: [
          ...source.providers,
          { ...source.providers[0], id: "other" },
        ],
      },
    ]);
    let s = emptyInventory();
    const [a, b] = c.statuses;
    s = updateInventory(s, { type: "status", id: a.id, enabled: true }, c);
    s = updateInventory(s, { type: "status-level", id: a.id, level: 4 }, c);
    let p = projectInventory(s, c, "melee");
    expect(p.modifiers.map((m) => m.amount)).toEqual([12, 80]);
    expect(p.statuses[0].duration).toBe(30);
    expect(p.configurationValue).toBe(0);
    expect(p.sources[0].id).toBe(`status:${a.id}`);
    expect(
      updateInventory(s, { type: "status-level", id: a.id, level: 5 }, c),
    ).toBe(s);
    expect(
      updateInventory(s, { type: "status-level", id: a.id, level: 1.5 }, c),
    ).toBe(s);
    s = updateInventory(s, { type: "status", id: b.id, enabled: true }, c);
    expect(s.statuses).toEqual([b.id]);
    p = projectInventory(s, c, "melee");
    expect(p.modifiers.map((m) => m.amount)).toEqual([6, 35]);
    s = updateInventory(s, { type: "status", id: b.id, enabled: false }, c);
    expect(projectInventory(s, c, "melee").modifiers).toEqual([]);
    expect(updateInventory(s, { type: "reset" }, c)).toEqual(emptyInventory());
  });
  it("groups by provider and searches state, skill and provider without dropping provenance", () => {
    const rows = catalog().statuses;
    expect(
      groupStatusResults(rows, "Ogre Bloodlust", "hero")[0].statuses[0]
        .sourceModifier,
    ).toBe("modifier_ogre_magi_bloodlust");
    expect(groupStatusResults(rows, "食人魔", "all")).toHaveLength(1);
    expect(groupStatusResults(rows, "", "item")).toHaveLength(0);
    expect(groupStatusResults(rows, "missing", "all")).toHaveLength(0);
  });
  it("does not invent effects, levels or providers for unreviewed/ambiguous sources", () => {
    expect(adaptHeroStatuses([source], zh, en, "unknown")[0].effects).toEqual(
      [],
    );
    expect(
      adaptHeroStatuses([{ ...source, maxLevel: 1 }], zh, en, commit)[0]
        .effects,
    ).toEqual([]);
    expect(
      adaptHeroStatuses([{ ...source, providers: [] }], zh, en, commit),
    ).toEqual([]);
    expect(() => adaptHeroStatuses([source, source], zh, en, commit)).toThrow(
      "Duplicate",
    );
    const generic = adaptHeroStatuses(
      [source],
      {
        ...zh,
        [`${token}_slow`]: "减速",
        [`${token}_slow_description`]: "未映射",
      },
      en,
      commit,
    ).find((s) => s.sourceModifier?.endsWith("_slow"))!;
    expect(generic.mapping).toBe("prefix");
    expect(generic.coverage).toBe("unmodeled");
    expect(generic.effects).toEqual([]);
  });
  it("shares aura uniqueness with equipped items and rejects identities absent in the version", () => {
    const aura: StatusSource = {
      id: "item_buckler",
      kind: "item",
      name: "盾牌",
      enName: "Buckler",
      maxLevel: 1,
      providers: [
        {
          id: "item_buckler",
          kind: "item",
          name: "盾牌",
          enName: "Buckler",
          href: "/items/item_buckler",
        },
      ],
      values: [
        {
          field: "bonus_aoe_armor",
          values: ["2"],
          name: "armor",
          enName: "armor",
        },
      ],
    };
    const texts = {
      dota_tooltip_modifier_item_buckler_effect: "Buckler",
      dota_tooltip_modifier_item_buckler_effect_description: "Armor increased.",
    };
    const status = adaptHeroStatuses([aura], texts, texts, commit)[0];
    expect(status.effects[0]).toMatchObject({
      amount: 2,
      group: "buckler-aura",
    });
    const c = catalog();
    const state = emptyInventory();
    expect(
      updateInventory(
        state,
        { type: "status", id: status.id, enabled: true },
        c,
      ),
    ).toBe(state);
  });
  it("excludes unit-only defenses while retaining a building aura on heroes", () => {
    const tower: StatusSource = {
      id: "tower_aura",
      kind: "building",
      name: "",
      enName: "",
      maxLevel: 1,
      values: [],
      providers: [
        {
          id: "tower",
          kind: "building",
          name: "防御塔",
          enName: "Tower",
          href: "/units/tower",
        },
      ],
    };
    const texts = {
      dota_tooltip_modifier_tower_aura: "Aura emitter",
      dota_tooltip_modifier_tower_aura_description:
        "Armor of nearby heroes increased.",
      dota_tooltip_modifier_tower_aura_bonus: "Tower protection",
      dota_tooltip_modifier_tower_aura_bonus_description: "Armor increased.",
    };
    expect(
      adaptHeroStatuses([tower], texts, texts, commit).map(
        (s) => s.sourceModifier,
      ),
    ).toEqual(["modifier_tower_aura_bonus"]);
    const ros: StatusSource = {
      ...tower,
      id: "roshan_devotion",
      kind: "ability",
      providers: [{ ...tower.providers[0], kind: "neutral" }],
    };
    const self = {
      dota_tooltip_modifier_roshan_devotion: "Devotion",
      dota_tooltip_modifier_roshan_devotion_description: "Roshan defenses.",
    };
    expect(adaptHeroStatuses([ros], self, self, commit)).toEqual([]);
  });
});
