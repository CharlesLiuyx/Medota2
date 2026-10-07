import { attributeTextParts } from "@/presentation/attribute-text";
import { expect, it } from "vitest";
import {
  attributeId,
  ATTRIBUTES,
  buildAttributeEntries,
  type AttributeRelation,
} from "@/domain/attributes";
import {
  attributeEvidence,
  attributeFormula,
  physicalDamageMultiplier,
  attackInterval,
  officialAttributeLabels,
} from "@/domain/attribute-mechanics";
import { adaptItems } from "@/importers/dota-vpk/item-adapter";
import { withRelease } from "@/domain/releases";
const commit = "f4c45719314754567cb4ef4fe343bbc790a311f4";
it("links plate mail armor, hero base armor and unit armor to one entity without merging unrelated owner parameters", () => {
  expect(attributeId("item", "item_platemail", "bonus_armor")).toBe("armor");
  expect(attributeId("hero", "npc_dota_hero_axe", "base_armor")).toBe("armor");
  expect(attributeId("unit", "npc_dota_creep", "ArmorPhysical")).toBe("armor");
  expect(attributeId("ability", "a", "duration")).not.toBe(
    attributeId("ability", "b", "duration"),
  );
  expect(attributeId("ability", "a", "bonus_damage")).not.toBe("attack-damage");
  const relation = {
    attributeId: "armor",
    kind: "item",
    owner: "item_platemail",
    href: "/items/item_platemail",
    zh: "板甲",
    en: "Plate Mail",
    field: "bonus_armor",
    value: "7",
    labelZh: "护甲",
    labelEn: "Armor",
    descriptionZh: "",
    descriptionEn: "",
    sourcePath: "scripts/npc/items.txt",
  } satisfies AttributeRelation;
  const entries = buildAttributeEntries([
    relation,
    {
      ...relation,
      kind: "hero",
      owner: "axe",
      field: "base_armor",
      value: "-1",
    },
  ]);
  expect(entries).toHaveLength(1);
  expect(entries[0].relations.map((r) => r.value)).toEqual(["7", "-1"]);
  expect(withRelease("/attributes/armor?lang=en", "c:historical")).toBe(
    "/attributes/armor?lang=en&release=c%3Ahistorical",
  );
});
it("keeps concepts without known values, and places cast backswing immediately after cast point", () => {
  const entries = buildAttributeEntries([], ATTRIBUTES);
  expect(entries.find((e) => e.id === "attack-backswing")?.relations).toEqual(
    [],
  );
  const cast = entries.findIndex((e) => e.id === "cast-point");
  expect(entries[cast + 1].id).toBe("cast-backswing");
  expect(entries[cast + 2].id).toBe("channel-time");
  const ids = new Set(ATTRIBUTES.map((a) => a.id));
  for (const entry of entries)
    for (const related of entry.related) expect(ids.has(related)).toBe(true);
});
it("retains every item value identity, unknown labels and conditional modifiers", () => {
  const { items } = adaptItems(
    '"DOTAAbilities" {"item_platemail" {"AbilityValues" {"bonus_armor" "7" "unknown_field" {"value" "2" "special_bonus_scepter" "+3"}}}}',
    {},
    {},
  );
  expect(items[0].stats).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: "bonus_armor",
        zh: "额外护甲",
        value: "7",
      }),
      expect.objectContaining({
        key: "unknown_field",
        value: "2",
        modifiers: expect.any(Object),
      }),
    ]),
  );
});
it("expands official attribute variables and retains the official night vision name", () => {
  const { items } = adaptItems(
    '"DOTAAbilities" {"item_platemail" {"AbilityValues" {"bonus_armor" "7"}}}',
    {
      dota_tooltip_ability_item_platemail_bonus_armor: "+$armor",
      dota_ability_variable_armor: "护甲",
    },
    {
      dota_tooltip_ability_item_platemail_bonus_armor: "+$armor",
      dota_ability_variable_armor: "Armor",
    },
  );
  expect(items[0].stats[0]).toMatchObject({
    zh: "护甲",
    en: "Armor",
    value: "7",
  });
  expect(officialAttributeLabels(commit, "night-vision")?.zh).toBe("夜间视野");
});
it("separates current panel evidence from conflicting legacy text and refuses unreviewed versions", () => {
  const data = attributeEvidence(
    commit,
    {
      id: "strength",
      zh: "力量",
      en: "Strength",
      unit: "点",
      summary: "",
      scope: "",
      token: "Strength",
      related: [],
    },
    "en",
  );
  expect(
    data.tokens.find((t) => t.token.includes("HeroStats"))?.text,
  ).toContain("22 Health");
  expect(
    data.tokens.find((t) => t.token.includes("StatTooltip"))?.text,
  ).toContain("20");
  expect(data.file?.raw_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(attributeFormula("strength", commit)?.expression).toContain("22");
  expect(attributeFormula("strength", "unknown")).toBeNull();
});
it("calculates documented examples including negative armor, zero armor and attack time", () => {
  expect(physicalDamageMultiplier(0)).toBe(1);
  expect(physicalDamageMultiplier(7) * 100).toBeCloseTo(70.422535, 5);
  expect(physicalDamageMultiplier(-10)).toBeCloseTo(1.375);
  expect(attackInterval(1.7, 200)).toBeCloseTo(0.85);
  expect(() => physicalDamageMultiplier(NaN)).toThrow();
  expect(() => attackInterval(1.7, 0)).toThrow();
});

import {
  attributeSlice,
  parseAttributeQuery,
} from "@/server/services/attribute-catalog";
it("pages all parameters in both directions and rejects cursors from another version or filter", () => {
  const entries = Array.from({ length: 110 }, (_, index) => ({
    id: `item~a~${index}`,
    zh: `参数${index}`,
    en: `Parameter ${index}`,
    summary: "",
    count: 1,
    owner: "A",
    kinds: ["item"],
    searchText: `parameter ${index}`,
  }));
  const query = parseAttributeQuery(new URLSearchParams("scope=all"));
  const first = attributeSlice(entries, "version-a", query);
  expect(first.items).toHaveLength(48);
  expect(first.items[0]).not.toHaveProperty("searchText");
  const second = attributeSlice(entries, "version-a", query, {
    after: first.nextCursor!,
  });
  expect(second.items[0].id).toBe("item~a~48");
  const previous = attributeSlice(entries, "version-a", query, {
    before: second.previousCursor!,
  });
  expect(previous.items).toEqual(first.items);
  expect(() =>
    attributeSlice(entries, "version-b", query, { after: first.nextCursor! }),
  ).toThrow("another query or version");
  expect(() =>
    attributeSlice(
      entries,
      "version-a",
      { q: "x", scope: "all" },
      { after: first.nextCursor! },
    ),
  ).toThrow();
  expect(() => parseAttributeQuery(new URLSearchParams("scope=no"))).toThrow();
});

import {
  auditNumericFields,
  numericAttributeFields,
  resolvedUnitAttributeFields,
} from "@/domain/attribute-fields";
it("accounts for root numeric fields, retains unknown gameplay parameters and resolves inherited unit values", () => {
  const fields = {
    entries: [
      { key: "AttackRangeBuffer", value: "250", line: 4 },
      { key: "NewGameplayParameter", value: "0 2.5", line: 5 },
      { key: "ModelScale", value: "0.8", line: 6 },
      { key: "HeroID", value: "2", line: 7 },
    ],
  };
  expect(auditNumericFields(fields)).toHaveLength(4);
  expect(numericAttributeFields(fields).map((e) => e.key)).toEqual([
    "AttackRangeBuffer",
    "NewGameplayParameter",
  ]);
  expect(auditNumericFields(fields).filter((e) => e.excluded)).toHaveLength(2);
  const resolved = resolvedUnitAttributeFields({
    entries: [
      { key: "npc_dota_units_base", value: fields },
      {
        key: "parent",
        value: {
          entries: [{ key: "AttackRangeBuffer", value: "100", line: 12 }],
        },
      },
      {
        key: "child",
        value: { entries: [{ key: "include_keys_from", value: "parent" }] },
      },
    ],
  });
  expect(numericAttributeFields(resolved.get("child"))).toContainEqual({
    key: "AttackRangeBuffer",
    value: "100",
    line: 12,
    excluded: null,
  });
  expect(attributeId("item", "item_a", "AbilityHealthCost")).toBe(
    "health-cost",
  );
  expect(attributeId("unit", "unit", "AttackAnimationPoint")).toBe(
    "attack-point",
  );
});

import {
  enumAttributeFields,
  formatAttributeEnum,
} from "@/domain/attribute-enums";
it("keeps enum alternatives, combined flags and unknown values without inventing defaults", () => {
  const fields = enumAttributeFields({
    entries: [
      { key: "SpellDispellableType", value: "SPELL_DISPELLABLE_YES_STRONG" },
      {
        key: "AbilityUnitTargetType",
        value: "DOTA_UNIT_TARGET_HERO | NEW_TARGET_TYPE",
      },
    ],
  });
  expect(fields).toHaveLength(2);
  expect(enumAttributeFields({ entries: [] })).toEqual([]);
  const base = {
    kind: "ability" as const,
    owner: "a",
    href: "/abilities/a",
    zh: "技能",
    en: "Ability",
    labelZh: "",
    labelEn: "",
    descriptionZh: "",
    descriptionEn: "",
    sourcePath: "scripts/npc/heroes/a.txt",
  };
  const entries = buildAttributeEntries(
    fields.map((f) => ({
      ...base,
      field: f.key,
      attributeId: attributeId("ability", "a", f.key),
      value: f.value,
    })),
    ATTRIBUTES,
  );
  const dispel = entries.find((e) => e.id === "dispel-type")!;
  expect(dispel.valueType).toBe("enum");
  expect(dispel.enumValues?.map((v) => v.value)).toEqual([
    "SPELL_DISPELLABLE_YES",
    "SPELL_DISPELLABLE_YES_STRONG",
    "SPELL_DISPELLABLE_NO",
  ]);
  expect(formatAttributeEnum(fields[0].value, dispel.enumValues, "zh-CN")).toBe(
    "仅强驱散",
  );
  const target = entries.find((e) => e.id === "target-type")!;
  expect(target.valueType).toBe("flags");
  expect(
    target.enumValues?.find((v) => v.value === "NEW_TARGET_TYPE")?.summary,
  ).toBe("枚举含义待核验");
  expect(formatAttributeEnum(fields[1].value, target.enumValues, "en")).toBe(
    "Hero · NEW_TARGET_TYPE",
  );
});

it("links longest attribute mentions without changing source wording or English word boundaries", () => {
  const text = "每点力量提供22点生命和0.1点/秒生命恢复。生命值未变。";
  const parts = attributeTextParts(text, "zh-CN", ATTRIBUTES);
  expect(parts.map((part) => part.text).join("")).toBe(text);
  expect(parts.filter((part) => part.attributeId)).toEqual([
    { text: "力量", attributeId: "strength" },
    { text: "生命", attributeId: "health" },
    { text: "生命恢复", attributeId: "health-regen" },
    { text: "生命值", attributeId: "health" },
  ]);
  expect(
    attributeTextParts(
      "Health regeneration, HEALTH; unhealthy source_health",
      "en",
      ATTRIBUTES,
    ).filter((part) => part.attributeId),
  ).toEqual([
    { text: "Health regeneration", attributeId: "health-regen" },
    { text: "HEALTH", attributeId: "health" },
  ]);
  expect(
    attributeTextParts("生命值", "zh-CN", [
      { id: "health", zh: "生命值", en: "Health" },
      { id: "other", zh: "生命值", en: "Other" },
    ]),
  ).toEqual([{ text: "生命值" }]);
});

it("keeps ordinary grid chunks complete when the primary group is present or filtered", () => {
  const query = { q: "", scope: "all" as const };
  const ordinary = Array.from({ length: 110 }, (_, i) => ({
    id: `ability~owner~field${i}`,
    zh: `field${i}`,
    en: `field${i}`,
    summary: "",
    owner: "",
    count: 1,
    kinds: ["ability" as const],
    searchText: "",
  }));
  for (const primaryCount of [0, 1, 2, 3]) {
    const primary = ["strength", "agility", "intelligence"]
      .slice(0, primaryCount)
      .map((id) => ({ ...ordinary[0], id }));
    const entries = [...primary, ...ordinary];
    const first = attributeSlice(entries, "grid", query);
    expect(first.items).toHaveLength(48 + primaryCount);
    const second = attributeSlice(entries, "grid", query, {
      after: first.nextCursor!,
    });
    const third = attributeSlice(entries, "grid", query, {
      after: second.nextCursor!,
    });
    expect(second.items).toHaveLength(48);
    expect(
      [...first.items, ...second.items, ...third.items].map(
        (entry) => entry.id,
      ),
    ).toEqual(entries.map((entry) => entry.id));
    expect(
      attributeSlice(entries, "grid", query, { before: second.previousCursor! })
        .items,
    ).toEqual(first.items);
    expect(
      attributeSlice(entries, "grid", query, { before: third.previousCursor! })
        .items,
    ).toEqual(second.items);
  }
});
