import { loadSplitHeroFixture } from "../helpers/split-hero-fixture";
import { describe, expect, it } from "vitest";
import { AbilityImportValidationError } from "@/domain/abilities";
import { parseAbilityDataset } from "@/importers/dota-vpk/ability-adapter";
import { parseHeroDataset } from "@/importers/dota-vpk/hero-adapter";
import {
  loadCatalogFixture,
  mutateCatalogFixture,
} from "../helpers/vpk-fixture";

describe("VPK ability adapter", () => {
  it("loads split heroes and nested abilities with the same values, relations and source paths", async () => {
    const files = await loadSplitHeroFixture();
    const heroes = parseHeroDataset(files);
    const dataset = parseAbilityDataset(files, heroes.heroes);
    const old = await loadCatalogFixture();
    const oldDataset = parseAbilityDataset(old, parseHeroDataset(old).heroes);
    expect(
      heroes.heroes.map((hero) => [hero.heroId, hero.movementSpeed]),
    ).toEqual(
      parseHeroDataset(old).heroes.map((hero) => [
        hero.heroId,
        hero.movementSpeed,
      ]),
    );
    expect(
      dataset.abilities.map((ability) => [
        ability.internalName,
        ability.cooldown,
        ability.catalogStatus,
      ]),
    ).toEqual(
      oldDataset.abilities.map((ability) => [
        ability.internalName,
        ability.cooldown,
        ability.catalogStatus,
      ]),
    );
    const gameplayBindings = (data: typeof dataset) =>
      data.bindings
        .filter((binding) => binding.relationKind !== "declared_in_hero_file")
        .map((binding) =>
          [
            binding.heroId,
            binding.abilityInternalName,
            binding.relationKind,
            binding.sourceSlot,
          ].join(":"),
        )
        .sort();
    expect(gameplayBindings(dataset)).toEqual(gameplayBindings(oldDataset));
    expect(heroes.heroes[0].source.sourcePath).toBe(
      "scripts/npc/heroes/npc_dota_hero_antimage.txt",
    );
    expect(
      dataset.abilities.find(
        (ability) => ability.source.declarationKind === "implicit_talent",
      )?.source.path,
    ).toBe("scripts/npc/heroes/npc_dota_hero_antimage.txt");
    expect(() =>
      parseHeroDataset(
        files.filter((file) => !file.path.endsWith("npc_dota_hero_base.txt")),
      ),
    ).toThrow("outside checked selector");
    expect(() =>
      parseHeroDataset(
        files.map((file) =>
          file.path === "scripts/npc/npc_heroes.txt"
            ? {
                ...file,
                text: file.text + '\n#base "heroes/npc_dota_hero_base.txt"',
              }
            : file,
        ),
      ),
    ).toThrow("Duplicate or cyclic");
  });

  it("preserves every source definition and materializes implicit talents", async () => {
    const files = await loadCatalogFixture();
    const heroes = parseHeroDataset(files).heroes;
    const dataset = parseAbilityDataset(files, heroes);

    expect(dataset.counts).toMatchObject({
      definitions: 8,
      sourceDefinitions: 8,
      implicitDefinitions: 1,
      accepted: 9,
      excluded: 0,
      blockingErrors: 0,
    });
    expect(dataset.abilities).toHaveLength(9);

    const blink = dataset.abilities.find(
      (ability) => ability.internalName === "antimage_blink",
    );
    expect(blink).toMatchObject({
      catalogStatus: "current",
      castPoint: "0.3",
      cooldown: "12 10 8 6",
      source: { declarationKind: "top_level" },
    });
    expect(blink?.values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          valueKey: "blink_range",
          levelValues: ["750", "900", "1050", "1200"],
          modifiers: [
            expect.objectContaining({
              key: "special_bonus_unique_antimage_fixture",
              value: "+100",
            }),
          ],
        }),
      ]),
    );

    const talent = dataset.abilities.find(
      (ability) =>
        ability.internalName === "special_bonus_unique_antimage_fixture",
    );
    expect(talent).toMatchObject({
      definitionKind: "talent",
      catalogStatus: "current",
      baseClass: "special_bonus_base",
      source: {
        declarationKind: "implicit_talent",
        path: "scripts/npc/npc_heroes.txt",
      },
    });
  });

  it("uses the final duplicate definition while retaining every occurrence", async () => {
    const files = await loadCatalogFixture();
    const dataset = parseAbilityDataset(files, parseHeroDataset(files).heroes);
    const duplicate = dataset.abilities.find(
      (ability) => ability.internalName === "fixture_duplicate",
    );
    expect(duplicate?.cooldown).toBe("10");
    expect(duplicate?.source.definitionOccurrences).toHaveLength(2);
    expect(dataset.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "duplicate_ability_definition" }),
        expect.objectContaining({ code: "ability_id_collision" }),
        expect.objectContaining({ code: "ability_name_multiple_ids" }),
      ]),
    );
  });

  it("does not misclassify a high numbered non-talent slot", async () => {
    const files = await loadCatalogFixture();
    const dataset = parseAbilityDataset(files, parseHeroDataset(files).heroes);
    expect(dataset.bindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityInternalName: "antimage_high_slot_helper",
          sourceSlot: "Ability20",
          relationKind: "loadout",
        }),
      ]),
    );
  });

  it("blocks missing direct ability targets and inheritance cycles", async () => {
    const missing = await mutateCatalogFixture(
      "scripts/npc/npc_heroes.txt",
      (text) =>
        text.replace(
          '"Ability1" "antimage_blink"',
          '"Ability1" "missing_fixture"',
        ),
    );
    expectValidationCode(
      () => parseAbilityDataset(missing, parseHeroDataset(missing).heroes),
      "missing_bound_ability_definition",
    );

    const cycle = await mutateCatalogFixture(
      "scripts/npc/heroes/npc_dota_hero_antimage.txt",
      (text) =>
        text
          .replace(
            '"BaseClass" "ability_base"',
            '"BaseClass" "antimage_high_slot_helper"',
          )
          .replace(
            '"antimage_high_slot_helper"\n  {',
            '"antimage_high_slot_helper"\n  {\n    "BaseClass" "antimage_blink"',
          ),
    );
    expectValidationCode(
      () => parseAbilityDataset(cycle, parseHeroDataset(cycle).heroes),
      "ability_inheritance_cycle",
    );
  });
});

function expectValidationCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected AbilityImportValidationError");
  } catch (error) {
    expect(error).toBeInstanceOf(AbilityImportValidationError);
    expect(
      (error as AbilityImportValidationError).issues.some(
        (issue) => issue.code === code,
      ),
    ).toBe(true);
  }
}
