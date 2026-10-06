import { describe, expect, it } from "vitest";
import { createSearchIndex } from "@/domain/search";
import { ABILITY_ALIASES, HERO_ALIASES } from "@/domain/search/aliases";

describe("player search vocabulary", () => {
  const heroes = createSearchIndex([
    {
      id: "antimage",
      names: ["敌法师", "Anti-Mage"],
      aliases: HERO_ALIASES.antimage,
    },
    {
      id: "drow",
      names: ["卓尔游侠", "Drow Ranger"],
      aliases: HERO_ALIASES.drow_ranger,
    },
    {
      id: "ogre",
      names: ["食人魔魔法师", "Ogre Magi"],
      aliases: HERO_ALIASES.ogre_magi,
    },
    {
      id: "doom",
      names: ["末日使者", "Doom"],
      aliases: HERO_ALIASES.doom_bringer,
    },
    {
      id: "earth",
      names: ["撼地者", "Earthshaker"],
      aliases: HERO_ALIASES.earthshaker,
    },
    {
      id: "ember",
      names: ["灰烬之灵", "Ember Spirit"],
      aliases: HERO_ALIASES.ember_spirit,
    },
  ]);
  it("matches Chinese, English, joined/spaced/tonal pinyin, initials and aliases", () => {
    for (const q of [
      "敌法",
      "ANTI-MAGE",
      "Ａｎｔｉ Ｍａｇｅ",
      "difashi",
      "di fa shi",
      "dí fǎ shī",
      "dfs",
      "magina",
      "am",
      "玛吉纳",
      "majina",
      "mjn",
    ])
      expect(heroes.search(q), q).toContain("antimage");
    for (const q of ["小黑", "xiaohei", "xh", "Traxex"])
      expect(heroes.search(q), q).toContain("drow");
    for (const q of ["蓝胖", "lanpang", "lp"])
      expect(heroes.search(q), q).toContain("ogre");
    expect(heroes.search("末日")).toEqual(["doom"]);
    expect(heroes.search("ES")).toEqual(["earth", "ember"]);
    expect(heroes.search("no-such-hero")).toEqual([]);
    expect(heroes.search("%")).toEqual([]);
    expect(heroes.search("_")).toEqual([]);
    expect(heroes.search("  ")).toHaveLength(6);
  });
  it("matches skill names and owner-qualified queries without searching descriptions", () => {
    const skills = createSearchIndex([
      {
        id: "blink",
        names: ["闪烁", "Blink"],
        aliases: ABILITY_ALIASES.antimage_blink,
        context: ["敌法师", "Anti-Mage", ...HERO_ALIASES.antimage],
      },
      {
        id: "hook",
        names: ["肉钩", "Meat Hook"],
        aliases: ABILITY_ALIASES.pudge_meat_hook,
        context: ["帕吉", "Pudge", ...HERO_ALIASES.pudge],
      },
      { id: "ravage", names: ["毁灭", "Ravage"] },
    ]);
    for (const q of [
      "闪烁",
      "Blink",
      "shanshuo",
      "ss",
      "闪现",
      "am blink",
      "敌法 闪烁",
      "dfs ss",
    ])
      expect(skills.search(q), q).toEqual(["blink"]);
    for (const q of ["钩子", "gouzi", "gz", "屠夫 hook"])
      expect(skills.search(q), q).toEqual(["hook"]);
    expect(skills.search("虚构技能说明")).toEqual([]);
  });
});
