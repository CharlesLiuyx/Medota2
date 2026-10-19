import {
  projectRankingHero,
  rankHeroValue,
  rankingNumber,
} from "@/presentation/hero-stat-rankings";
import {
  HeroReferenceProvider,
  HeroReferenceText,
} from "@/components/hero-reference-text";
// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AbilityTooltip } from "@/components/ability-tooltip";
import { HeroOverview as Overview } from "@/components/hero-overview";
import { HeroBuildProvider } from "@/components/hero-build-provider";
import { abilityWithTalents } from "@/presentation/ability-talents";
import { heroStatsAtLevel } from "@/presentation/hero-stats";
import { adaptHeroTalents } from "@/presentation/hero-talents";
import {
  updateHeroBuild,
  selectedHeroTalents,
  type HeroBuildState,
  type HeroTalent,
} from "@/domain/hero-build";
import { abilityAtLevel, abilityMaxLevel } from "@/presentation/ability-levels";
import { upgradedValues, type TooltipAbility } from "@/presentation/dota";

function HeroOverview({
  talents,
  ...props
}: React.ComponentProps<typeof Overview> & { talents: readonly HeroTalent[] }) {
  return (
    <HeroBuildProvider talents={talents}>
      <Overview {...props} />
    </HeroBuildProvider>
  );
}

vi.mock("@/components/ability-icon", () => ({ AbilityIcon: () => null }));
vi.mock("@/components/attribute-link", () => ({
  AttributeLink: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/version-link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true,
  value: vi.fn(),
});
afterEach(cleanup);
const sourceCommit = "f4c45719314754567cb4ef4fe343bbc790a311f4";
const sven = {
  internal_name: "npc_dota_hero_sven",
  primary_attribute: "strength",
  base_strength: 24,
  strength_gain: 3.5,
  base_agility: 18,
  agility_gain: 2.2,
  base_intelligence: 16,
  intelligence_gain: 1.5,
  base_health: 120,
  base_health_regen: 0.75,
  base_mana: 75,
  base_mana_regen: 0,
  base_attack_damage_min: 37,
  base_attack_damage_max: 39,
  base_attack_speed: 110,
  base_armor: 0,
  magic_resistance: 25,
};

const buildTalents: HeroTalent[] = [
  {
    id: "strength",
    name: "+15 力量",
    level: 20,
    side: 0,
    coverage: "stats",
    effects: [{ kind: "flat", stat: "strength", amount: 15 }],
  },
  {
    id: "helix",
    name: "+40 反击螺旋伤害",
    level: 20,
    side: 1,
    coverage: "ability",
    effects: [],
  },
  {
    id: "call",
    name: "+85 狂战士之吼范围",
    level: 25,
    side: 0,
    coverage: "ability",
    effects: [],
  },
];

it("keeps talent levels, switching, deselection and second unlocks consistent", () => {
  let state: HeroBuildState = { level: 1, selectedTalents: [] };
  const act = (action: Parameters<typeof updateHeroBuild>[1]) =>
    (state = updateHeroBuild(state, action, buildTalents));
  act({ type: "talent", id: "call" });
  expect(state).toEqual({ level: 25, selectedTalents: ["call"] });
  act({ type: "talent", id: "call" });
  expect(state).toEqual({ level: 25, selectedTalents: [] });
  act({ type: "talent", id: "strength" });
  act({ type: "talent", id: "helix" });
  expect(state.selectedTalents).toEqual(["helix"]);
  act({ type: "level", level: 29 });
  act({ type: "talent", id: "strength" });
  expect(state.selectedTalents).toEqual(["helix", "strength"]);
  act({ type: "level", level: 28 });
  expect(state.selectedTalents).toEqual(["helix"]);
  act({ type: "level", level: 19 });
  expect(state.selectedTalents).toEqual([]);
  expect(
    selectedHeroTalents(
      { level: 1, selectedTalents: ["strength", "invented"] },
      buildTalents,
    ),
  ).toEqual([]);
});

it("reads real talent values rather than ID suffixes or localized descriptions", () => {
  const talent = (id: string, value: string): TooltipAbility => ({
    internal_name: id,
    display_name: "+999 魔法恢复",
    description: null,
    values: [{ value_key: "value", level_values: [value] }],
  });
  const inputs = [
    talent("special_bonus_mp_regen_150", "1.5"),
    talent("special_bonus_strength_15", "15"),
    talent("special_bonus_unique_axe_7", "10"),
  ];
  const spell = {
    ...talent("axe_berserkers_call", "12"),
    values: [
      {
        value_key: "armor",
        level_values: ["12"],
        modifiers: [{ key: "special_bonus_unique_axe_7", value: "+10" }],
      },
    ],
  };
  const adapted = adaptHeroTalents(inputs, [spell], sourceCommit, "zh-CN");
  expect(adapted[0].effects).toEqual([
    { kind: "flat", stat: "manaRegen", amount: 1.5 },
  ]);
  expect(adapted[1].effects).toEqual([
    { kind: "flat", stat: "strength", amount: 15 },
  ]);
  expect(adapted[2]).toMatchObject({ coverage: "ability", effects: [] });
  expect(adaptHeroTalents(inputs, [spell], "unknown", "en")[0]).toMatchObject({
    coverage: "unmodeled",
    effects: [],
  });
  expect(
    adaptHeroTalents(
      [talent("special_bonus_strength_15", "15 20")],
      [],
      sourceCommit,
      "en",
    )[0].effects,
  ).toEqual([]);
});

it("propagates selected strength to health, regen and damage, and stacks resistance multiplicatively", () => {
  const result = heroStatsAtLevel(
    sven,
    20,
    sourceCommit,
    buildTalents[0].effects,
  );
  expect(result).toMatchObject({
    strength: 105.5,
    health: 2441,
    healthRegen: 11.3,
    damageMin: 142.5,
    damageMax: 144.5,
  });
  expect(
    heroStatsAtLevel(sven, 1, sourceCommit, [
      { kind: "resistance", stat: "magicResistance", amount: 15 },
    ]).magicResistance,
  ).toBe(37.61);
  expect(
    heroStatsAtLevel(sven, 1, sourceCommit, [
      { kind: "flat", stat: "manaRegen", amount: 1.5 },
    ]).manaRegen,
  ).toBe(2.3);
});

it("updates the visible panel when a talent is selected, replaced, deselected or invalidated by level", () => {
  const { container } = render(
    <HeroOverview
      intro={<h1>斯温</h1>}
      stats={<p>基础属性</p>}
      talents={buildTalents}
      hero={sven}
      sourceCommit={sourceCommit}
    />,
  );
  const level = screen.getByRole("slider", { name: "英雄等级" });
  const strengthTalent = screen.getByRole("button", {
    name: "+15 力量",
  });
  fireEvent.click(strengthTalent);
  expect((level as HTMLInputElement).value).toBe("20");
  expect(strengthTalent.getAttribute("aria-pressed")).toBe("true");
  expect(
    container.querySelector('[data-hero-stat="health"]')?.textContent,
  ).toBe("2441");
  fireEvent.click(screen.getByRole("button", { name: "+40 反击螺旋伤害" }));
  expect(strengthTalent.getAttribute("aria-pressed")).toBe("false");
  expect(
    container.querySelector('[data-hero-stat="health"]')?.textContent,
  ).toBe("2111");
  fireEvent.click(strengthTalent);
  fireEvent.click(strengthTalent);
  expect(
    container.querySelector('[data-hero-stat="health"]')?.textContent,
  ).toBe("2111");
  fireEvent.click(strengthTalent);
  fireEvent.change(level, { target: { value: "19" } });
  expect(strengthTalent.getAttribute("aria-pressed")).toBe("false");
  expect(
    container.querySelector('[data-hero-stat="health"]')?.textContent,
  ).toBe("2034");
});

it("calculates reviewed naked Sven stats at levels 1 and 30 without rounding inputs", () => {
  expect(heroStatsAtLevel(sven, 1, sourceCommit)).toMatchObject({
    health: 648,
    healthRegen: 3.15,
    mana: 267,
    manaRegen: 0.8,
    damageMin: 61,
    damageMax: 63,
    armor: 2.88,
    attackSpeed: 128,
    magicResistance: 26.6,
  });
  expect(heroStatsAtLevel(sven, 30, sourceCommit)).toMatchObject({
    health: 2881,
    healthRegen: 13.3,
    mana: 789,
    manaRegen: 2.975,
    damageMin: 162.5,
    damageMax: 164.5,
    armor: 13.088,
    attackSpeed: 191.8,
    magicResistance: 30.95,
  });
  expect(
    heroStatsAtLevel(
      { ...sven, primary_attribute: "universal" },
      1,
      sourceCommit,
    ).damageMin,
  ).toBe(63.1);
  expect(
    heroStatsAtLevel({ ...sven, primary_attribute: "agility" }, 1, sourceCommit)
      .damageMin,
  ).toBe(55);
  expect(
    heroStatsAtLevel(
      { ...sven, primary_attribute: "intelligence" },
      1,
      sourceCommit,
    ).damageMin,
  ).toBe(53);
});

it("preserves missing fields and zero, and rejects unreviewed mechanics", () => {
  expect(heroStatsAtLevel(sven, 30, "unknown")).toMatchObject({
    supported: false,
    health: null,
    damageMin: null,
    strength: 125.5,
  });
  expect(
    heroStatsAtLevel(
      { ...sven, strength_gain: null, base_mana: "" },
      30,
      sourceCommit,
    ),
  ).toMatchObject({ health: null, mana: null, damageMin: null, armor: 13.088 });
  expect(
    heroStatsAtLevel(
      {
        ...sven,
        base_strength: 0,
        strength_gain: 0,
        base_health: 0,
        primary_attribute: "unknown",
      },
      30,
      sourceCommit,
    ),
  ).toMatchObject({ health: 0, damageMin: null });
  expect(heroStatsAtLevel(sven, 100, sourceCommit).level).toBe(30);
  expect(heroStatsAtLevel(sven, -1, sourceCommit).level).toBe(1);
});
const ability: TooltipAbility = {
  internal_name: "sven_warcry",
  display_name: "战吼",
  description: "提升%armor%点护甲。",
  max_level: 4,
  cooldown: "36 32 28 24",
  mana_cost: "30 35 40 45",
  values: [
    {
      value_key: "armor",
      level_values: ["5", "8", "11", "14"],
      modifiers: [{ key: "special_bonus_shard", value: "+1 +2 +3 +4" }],
    },
  ],
};

it("uses explicit limits and excludes inherited zero damage from ultimate level counts", () => {
  expect(abilityMaxLevel({ ...ability, max_level: 1 })).toBe(1);
  expect(
    abilityMaxLevel({
      ...ability,
      max_level: null,
      is_ultimate: true,
      damage: "0 0 0 0",
      cooldown: "110 100 90",
      mana_cost: "100 125 150",
      values: [],
    }),
  ).toBe(3);
  expect(abilityMaxLevel({ ...ability, max_level: null })).toBe(4);
  expect(
    abilityMaxLevel({
      internal_name: "unknown",
      display_name: null,
      description: null,
      values: [],
    }),
  ).toBeNull();
});

it("changes the description, cooldown, mana and upgrade values together", () => {
  const { container } = render(
    <AbilityTooltip ability={ability} assetVersion="assets" adjustableLevel />,
  );
  const description = container.querySelector(".game-description")!;
  expect(description.textContent?.trim()).toBe("提升5 / 8 / 11 / 14点护甲。");
  expect(description.querySelector("[data-selected]")?.textContent).toBe("5");
  fireEvent.click(screen.getByRole("radio", { name: "4" }));
  expect(description.textContent?.trim()).toBe("提升5 / 8 / 11 / 14点护甲。");
  expect(description.querySelector("[data-selected]")?.textContent).toBe("14");
  expect(screen.getByText(/冷却/).textContent).toContain("24");
  expect(screen.getByText(/魔法消耗/).textContent).toContain("45");
  expect(upgradedValues(abilityAtLevel(ability, 4).values, "shard").armor).toBe(
    "18",
  );
  expect(ability.values[0].level_values).toEqual(["5", "8", "11", "14"]);
});

it("lets a reader select hero level 30 and shows known attribute growth", () => {
  const { container } = render(
    <HeroOverview
      intro={<h1>斯温</h1>}
      stats={<p>基础属性</p>}
      talents={[]}
      hero={sven}
      sourceCommit={sourceCommit}
    />,
  );
  fireEvent.change(screen.getByRole("slider", { name: "英雄等级" }), {
    target: { value: "30" },
  });
  expect(
    container.querySelector('[data-hero-attribute="strength"]')?.textContent,
  ).toBe("125.5");
  expect(
    container.querySelector('[data-hero-attribute="agility"]')?.textContent,
  ).toBe("81.8");
  expect(
    container.querySelector('[data-hero-attribute="intelligence"]')
      ?.textContent,
  ).toBe("59.5");
  expect(
    container.querySelector('[data-hero-stat="health"]')?.textContent,
  ).toBe("2881");
  expect(
    screen
      .getByRole("meter", { name: "生命值上限" })
      .getAttribute("aria-valuenow"),
  ).toBe("2881");
  expect(
    container.querySelector('[data-hero-stat="healthRegen"]')?.textContent,
  ).toBe("+13.3");
  expect(
    container.querySelector('[data-stat-row="health"]')?.textContent,
  ).toContain("生命值");
  expect(
    container.querySelector('[data-stat-row="health"]')?.textContent,
  ).not.toContain("上限");
  const healthScale = container.querySelector('[data-stat-scale="health"]')!;
  expect(healthScale.getAttribute("viewBox")).toBe("0 0 2894.3 1");
  expect(
    healthScale.querySelector('[data-scale-step="100"]')?.getAttribute("width"),
  ).toBe("100");
  expect(
    healthScale
      .querySelector('[data-scale-step="1000"]')
      ?.getAttribute("width"),
  ).toBe("1000");
  expect(
    healthScale
      .querySelector('[data-scale-step="100"] path')
      ?.getAttribute("stroke-width"),
  ).toBe("1");
  expect(
    healthScale
      .querySelector('[data-scale-step="1000"] path')
      ?.getAttribute("stroke-width"),
  ).toBe("2");
  const healthFill = container.querySelector(
    '[data-hero-stat-fill="health"]',
  ) as HTMLElement;
  const healthRegen = container.querySelector(
    '[data-hero-stat-regen="health"]',
  ) as HTMLElement;
  const manaRegen = container.querySelector(
    '[data-hero-stat-regen="mana"]',
  ) as HTMLElement;
  expect(parseFloat(healthFill.style.width)).toBeCloseTo(
    (2881 / 2894.3) * 100,
    6,
  );
  expect(parseFloat(healthRegen.style.width)).toBeCloseTo(
    (13.3 / 2894.3) * 100,
    6,
  );
  expect(
    parseFloat(healthRegen.style.left) + parseFloat(healthRegen.style.width),
  ).toBeCloseTo(100, 6);
  expect(parseFloat(manaRegen.style.width)).toBeCloseTo(
    (2.975 / 791.975) * 100,
    6,
  );
  fireEvent.change(screen.getByRole("slider", { name: "英雄等级" }), {
    target: { value: "1" },
  });
  expect(
    container.querySelector('[data-hero-stat="health"]')?.textContent,
  ).toBe("648");
  expect(parseFloat(healthRegen.style.width)).toBeCloseTo(
    (3.15 / 2894.3) * 100,
    6,
  );
  expect(parseFloat(healthRegen.style.left)).toBeCloseTo(
    (648 / 2894.3) * 100,
    6,
  );
  expect(
    screen
      .getByRole("meter", { name: "魔法值上限" })
      .getAttribute("aria-valuenow"),
  ).toBe("267");
});

it("anchors numeric meter scales at zero when armor is negative", () => {
  const { container } = render(
    <HeroOverview
      intro={<h1>斯温</h1>}
      stats={null}
      talents={[]}
      hero={{ ...sven, base_armor: -4 }}
      sourceCommit={sourceCommit}
    />,
  );
  const scale = container.querySelector('[data-stat-scale="armor"]')!;
  const [minimum, , range] = scale
    .getAttribute("viewBox")!
    .split(" ")
    .map(Number);
  expect(minimum).toBeCloseTo(-1.12, 6);
  expect(range).toBeCloseTo(10.208, 6);
  expect(scale.querySelectorAll("pattern")).toHaveLength(2);
  expect(scale.querySelector("pattern")?.getAttribute("patternUnits")).toBe(
    "userSpaceOnUse",
  );
});

it("projects talent modifiers with shared numeric grammar and preserves unresolved conditions", () => {
  const source: TooltipAbility = {
    internal_name: "sample",
    display_name: "Sample",
    description: "%damage%",
    values: [
      {
        value_key: "damage",
        level_values: ["100", "160"],
        modifiers: [
          { key: "bonus", value: "+40" },
          { key: "ratio", value: "+25%" },
        ],
      },
      {
        value_key: "AbilityCooldown",
        level_values: ["20", "10"],
        modifiers: [{ key: "bonus", value: "-2 -4" }],
      },
      {
        value_key: "radius",
        level_values: ["200"],
        modifiers: [{ key: "bonus", value: "=400" }],
      },
      {
        value_key: "multiplier",
        level_values: ["2"],
        modifiers: [{ key: "bonus", value: "*3" }],
      },
      {
        value_key: "conditional",
        level_values: ["5"],
        modifiers: [{ key: "bonus", value: { condition: "+10" } }],
      },
    ],
  };
  const before = JSON.stringify(source);
  const projection = abilityWithTalents(abilityAtLevel(source, 2), [
    "bonus",
    "ratio",
    "foreign",
  ]);
  expect(projection.ability.values.map((row) => row.level_values)).toEqual([
    ["250"],
    ["6"],
    ["400"],
    ["6"],
    [],
  ]);
  expect(projection.ability.cooldown).toBe("6");
  expect(projection.appliedTalentIds).toEqual(["bonus", "ratio"]);
  expect(projection.unresolvedTalentIds).toEqual(["bonus"]);
  expect(JSON.stringify(source)).toBe(before);
  expect(
    abilityWithTalents(abilityAtLevel(source, 2), []).ability.values[0]
      .level_values,
  ).toEqual(["160"]);
});

it("shares talent selection with skill level, descriptions, notes and upgrade values, then restores them", () => {
  const spell: TooltipAbility = {
    ...ability,
    description: "提升%armor%点护甲。",
    shard_description: "升级后护甲%armor%。",
    values: [
      {
        value_key: "armor",
        level_values: ["5", "8", "11", "14"],
        modifiers: [
          { key: "helix", value: "+40" },
          { key: "special_bonus_shard", value: "+1 +2 +3 +4" },
        ],
      },
    ],
  };
  const { container } = render(
    <HeroBuildProvider talents={buildTalents}>
      <Overview
        intro={<h1>斯温</h1>}
        stats={null}
        hero={sven}
        sourceCommit={sourceCommit}
      />
      <AbilityTooltip
        ability={spell}
        assetVersion="assets"
        adjustableLevel
        tokens={{ dota_tooltip_ability_sven_warcry_note0: "当前护甲%armor%。" }}
      />
    </HeroBuildProvider>,
  );
  const description = container.querySelector(".game-description")!;
  const upgradeDescription = container.querySelector(
    ".aghanim .game-description",
  )!;
  const selected = (element: Element) =>
    element.querySelector("[data-selected]")?.textContent;
  const choice = screen.getByRole("button", { name: "+40 反击螺旋伤害" });
  fireEvent.click(choice);
  expect(description.textContent?.trim()).toBe("提升45 / 48 / 51 / 54点护甲。");
  expect(selected(description)).toBe("45");
  expect(container.querySelector("article ul li")?.textContent).toBe(
    "当前护甲45 / 48 / 51 / 54。",
  );
  expect(upgradeDescription.textContent?.trim()).toBe(
    "升级后护甲46 / 50 / 54 / 58。",
  );
  expect(selected(upgradeDescription)).toBe("46");
  const card = within(container.querySelector("article")!);
  fireEvent.click(card.getByRole("radio", { name: "4" }));
  expect(selected(description)).toBe("54");
  expect(selected(upgradeDescription)).toBe("58");
  fireEvent.click(choice);
  expect(description.textContent?.trim()).toBe("提升5 / 8 / 11 / 14点护甲。");
  expect(selected(description)).toBe("14");
  expect(upgradeDescription.textContent?.trim()).toBe(
    "升级后护甲6 / 10 / 14 / 18。",
  );
  expect(selected(upgradeDescription)).toBe("18");
  fireEvent.click(choice);
  fireEvent.change(screen.getByRole("slider", { name: "英雄等级" }), {
    target: { value: "1" },
  });
  expect(description.textContent?.trim()).toBe("提升5 / 8 / 11 / 14点护甲。");
  expect(selected(description)).toBe("14");
  expect(container.querySelector("[data-applied-talents]")).toBeNull();
});

it("keeps all ranks visible while shared levels and permanent stats change in both directions", () => {
  const spell: TooltipAbility = {
    ...ability,
    internal_name: "antimage_counterspell",
    values: [
      { value_key: "magic_resistance", level_values: ["14", "21", "28", "35"] },
    ],
  };
  const { container } = render(
    <HeroBuildProvider
      talents={[]}
      abilities={[spell]}
      sourceCommit={sourceCommit}
    >
      <Overview
        intro={null}
        stats={null}
        hero={sven}
        sourceCommit={sourceCommit}
      />
      <AbilityTooltip
        ability={spell}
        adjustableLevel
        assetVersion="assets"
        tokens={{
          dota_tooltip_ability_antimage_counterspell_magic_resistance:
            "%魔法抗性",
        }}
      />
    </HeroBuildProvider>,
  );
  const row = container.querySelector(
    '[data-ability-value="magic_resistance"] dd',
  )!;
  const select = (rank: string) => {
    fireEvent.click(screen.getByRole("radio", { name: rank }));
  };
  expect(row.textContent).toBe("14 / 21 / 28 / 35%");
  expect(row.querySelector("[data-selected]")).toBeNull();
  select("4");
  expect(screen.getByRole("slider").getAttribute("value")).toBe("7");
  expect(row.querySelector("[data-selected]")?.textContent).toBe("35%");
  // Sven lv7 intelligence=25 => baseline resistance 27.5%, stacked with 35%.
  expect(
    container.querySelector('[data-hero-stat="magicResistance"]')?.textContent,
  ).toBe("52.875%");
  fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
  expect(row.querySelector("[data-selected]")?.textContent).toBe("14");
  expect(
    container.querySelector('[data-hero-stat="magicResistance"]')?.textContent,
  ).toBe("36.876%");
  select("未学习");
  expect(row.querySelector("[data-selected]")).toBeNull();
  expect(
    container.querySelector('[data-hero-stat="magicResistance"]')?.textContent,
  ).toBe("26.6%");
});

it("enforces point budgets, ultimate thresholds, explicit exceptions, linked and dependent skills", async () => {
  const { heroAbilityRules } = await import("@/presentation/ability-levels");
  const { updateAbilityBuild, heroAbilityLevel } =
    await import("@/domain/hero-abilities");
  const spells: TooltipAbility[] = [
    {
      ...ability,
      internal_name: "a",
      source_definition: { entries: [{ key: "LinkedAbility", value: "b" }] },
    },
    { ...ability, internal_name: "b" },
    { ...ability, internal_name: "c" },
    { ...ability, internal_name: "ult", max_level: 3, is_ultimate: true },
    {
      ...ability,
      internal_name: "meepo",
      max_level: 3,
      is_ultimate: true,
      source_definition: {
        entries: [
          { key: "RequiredLevel", value: "4" },
          { key: "LevelsBetweenUpgrades", value: "7" },
        ],
      },
    },
    {
      ...ability,
      internal_name: "innate",
      is_innate: true,
      behavior: "NOT_LEARNABLE",
      source_definition: {
        entries: [{ key: "DependentOnAbility", value: "ult" }],
      },
    },
  ];
  spells.push({
    ...ability,
    internal_name: "dependent",
    behavior: "NOT_LEARNABLE",
    source_definition: { entries: [{ key: "DependentOnAbility", value: "a" }] },
  });
  const rules = heroAbilityRules(spells);
  let state = {
    level: 1,
    selectedTalents: [] as string[],
    abilityLevels: {} as Record<string, number>,
  };
  const act = (action: Parameters<typeof updateAbilityBuild>[1]) =>
    (state = updateAbilityBuild(state, action, [], rules));
  const rank = (id: string) =>
    heroAbilityLevel(
      state,
      rules.find((r) => r.id === id)!,
      rules,
    );
  act({ type: "ability", id: "a", level: 4 });
  expect(state.level).toBe(7);
  expect(rank("b")).toBe(4);
  expect(rank("dependent")).toBe(4);
  act({ type: "ability", id: "c", level: 4 });
  expect(state.level).toBe(8);
  act({ type: "ability", id: "ult", level: 3 });
  expect(state.level).toBe(18);
  expect(rank("innate")).toBe(4);
  act({ type: "level", level: 5 });
  expect(rank("ult")).toBe(0);
  expect(rank("innate")).toBe(1);
  expect(rank("a") + rank("c")).toBe(5);
  act({ type: "level", level: 1 });
  expect(rank("a") + rank("c")).toBe(1);
  expect(rank("dependent")).toBe(rank("a"));
  act({ type: "ability", id: "meepo", level: 2 });
  expect(state.level).toBe(11);
  act({ type: "level", level: 3 });
  expect(rank("meepo")).toBe(0);
});

it("highlights Invoker parameter levels from the source levelkey instead of the spell's fixed rank", () => {
  const quas: TooltipAbility = {
    ...ability,
    internal_name: "invoker_quas",
    max_level: 8,
  };
  const snap: TooltipAbility = {
    ...ability,
    internal_name: "invoker_cold_snap",
    max_level: 1,
    behavior: "NOT_LEARNABLE",
    description: "造成%damage%伤害。",
    values: [
      {
        value_key: "damage",
        level_values: ["28", "36", "44", "52", "60", "68", "76", "84", "92"],
        modifiers: [{ key: "levelkey", value: "quaslevel" }],
      },
    ],
  };
  const { container } = render(
    <HeroBuildProvider talents={[]} abilities={[quas, snap]}>
      <AbilityTooltip ability={quas} adjustableLevel assetVersion="assets" />
      <AbilityTooltip ability={snap} adjustableLevel assetVersion="assets" />
    </HeroBuildProvider>,
  );
  const spell = container.querySelector("#skill-invoker_cold_snap")!;
  expect(
    spell.querySelector('[data-ability-value="damage"] [data-selected]'),
  ).toBeNull();
  fireEvent.click(
    within(container.querySelector("#skill-invoker_quas")!).getByRole("radio", {
      name: "4",
    }),
  );
  expect(
    spell.querySelector('[data-ability-value="damage"] [data-selected]')
      ?.textContent,
  ).toBe("52");
  expect(
    spell.querySelector(".game-description [data-selected]")?.textContent,
  ).toBe("52");
});

it("uses the evaluated expression for substituted values and precise dependencies", async () => {
  const { expressionDependencies, expressionText } =
    await import("@/presentation/hero-stats");
  const result = heroStatsAtLevel(
    { ...sven, attack_rate: 1.7 },
    2,
    sourceCommit,
    [
      { kind: "flat", stat: "strength", amount: 10 },
      { kind: "flat", stat: "health", amount: 175 },
      { kind: "percent", stat: "health", amount: 10 },
      { kind: "percent", stat: "baseAttackTime", amount: -20 },
      { kind: "flat", stat: "attackSpeed", amount: 100 },
    ],
  );
  expect(result.strength).toBe(37.5);
  expect(result.health).toBe(1232);
  expect(result.baseAttackTime).toBe(1.36);
  for (const [key, expression] of Object.entries(result.calculations)) {
    expect(expression.value).toBe(result[key as keyof typeof result]);
  }
  expect(
    expressionText(result.calculations.health, (key) => key, true),
  ).toContain("37.5 × 22");
  expect(expressionDependencies(result.calculations.health)).toEqual(
    expect.arrayContaining([
      "strength",
      "base_strength",
      "level",
      "flat:health",
      "percent:health",
    ]),
  );
  expect(expressionDependencies(result.calculations.baseAttackTime)).toEqual([
    "attack_rate",
    "percent:baseAttackTime",
  ]);
  expect(
    expressionText(result.calculations.baseAttackTime, (key) => key, true),
  ).toBe("(1.7 × (1 + (-20 ÷ 100)))");
  expect(
    heroStatsAtLevel(sven, 2, "unknown").calculations.health.value,
  ).toBeNull();
  expect(
    heroStatsAtLevel({ ...sven, base_strength: "" }, 2, sourceCommit)
      .calculations.health.value,
  ).toBeNull();
});

it("explains calculated attack time on focus and clears linked source highlighting on Escape", async () => {
  const { HeroStatRelation } =
    await import("@/components/hero-stats-relations");
  const { container } = render(
    <HeroOverview
      hero={{ ...sven, attack_rate: 1.7 }}
      sourceCommit={sourceCommit}
      talents={[]}
      intro={null}
      stats={
        <>
          <HeroStatRelation field="attack_rate">1.7</HeroStatRelation>
          <HeroStatRelation field="base_attack_speed">110</HeroStatRelation>
        </>
      }
    />,
  );
  const trigger = screen.getByRole("button", {
    name: "基础攻击间隔 · 计算方法",
  });
  fireEvent.focus(trigger);
  expect(screen.getByRole("tooltip").textContent).toContain(
    "(1.7 × (1 + (0 ÷ 100))) = 1.7",
  );
  expect(
    container
      .querySelector('[data-stat-source="attack_rate"]')
      ?.getAttribute("data-related"),
  ).toBe("true");
  expect(
    container
      .querySelector('[data-stat-source="base_attack_speed"]')
      ?.hasAttribute("data-related"),
  ).toBe(false);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
  expect(container.querySelector("[data-related]")).toBeNull();
});

it("keeps talent reference terms intact and leaves ambiguous skill names unlinked", () => {
  const first = {
    ...ability,
    internal_name: "strength_strike",
    display_name: "力量打击",
  };
  const { rerender } = render(
    <HeroReferenceProvider
      abilities={[first]}
      tokens={{}}
      assetVersion="fixture"
    >
      <HeroReferenceText text="+15 力量，力量打击伤害提高。未知效果" />
    </HeroReferenceProvider>,
  );
  expect(
    screen.getByRole("link", { name: "力量打击" }).getAttribute("href"),
  ).toBe("#skill-strength_strike");
  expect(screen.getByRole("link", { name: "力量" }).getAttribute("href")).toBe(
    "/attributes/strength",
  );
  expect(screen.getByRole("link", { name: "伤害" }).getAttribute("href")).toBe(
    "/attributes/damage",
  );
  rerender(
    <HeroReferenceProvider
      abilities={[first, { ...first, internal_name: "other" }]}
      tokens={{}}
      assetVersion="fixture"
    >
      <HeroReferenceText text="力量打击" />
    </HeroReferenceProvider>,
  );
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.getByText("力量打击")).toBeTruthy();
});

it("ranks same-level values with tied endpoints, missing values and one current hero", () => {
  const points = [
    { id: "a", name: "A", value: 10 },
    { id: "b", name: "B", value: 20 },
    { id: "c", name: "C", value: 20 },
    { id: "d", name: "D", value: 30 },
  ];
  const middle = rankHeroValue(points, points[1]);
  expect([middle.rank, middle.total, middle.percentile, middle.equal]).toEqual([
    2, 4, 50, 2,
  ]);
  expect(rankHeroValue(points, points[0]).percentile).toBe(0);
  const top = rankHeroValue(points, { ...points[1], value: 30 });
  expect([top.rank, top.total, top.percentile, top.equal]).toEqual([
    1, 4, 100, 2,
  ]);
  expect(rankHeroValue([points[0]], points[0]).percentile).toBe(50);
  expect(rankingNumber(null)).toBeNull();
  expect(rankingNumber(" ")).toBeNull();
  expect(rankingNumber("-1")).toBe(-1);
  const hero = { ...sven, name: "Sven" };
  const initial = projectRankingHero(hero, 1, sourceCommit);
  const later = projectRankingHero(hero, 20, sourceCommit);
  expect(initial.values.health).toBe(648);
  expect(later.values.health).toBe(2111);
  expect(initial.growth.health).toBe(77);
  expect(later.growth.health).toBe(77);
  expect(projectRankingHero(hero, 30, sourceCommit).growth.health).toBe(77);
  expect(initial.values.damageMax! - initial.values.damageMin!).toBe(2);
  expect(initial.growth.movementSpeed).toBeUndefined();
  expect(projectRankingHero(hero, 1, null).values.health).toBeNull();
  const equipped = projectRankingHero(hero, 20, sourceCommit, [
    { kind: "flat", stat: "strength", amount: 10 },
  ]);
  expect(equipped.values.health! - later.values.health!).toBe(220);
  expect(equipped.growth.health).toBe(77);
});
