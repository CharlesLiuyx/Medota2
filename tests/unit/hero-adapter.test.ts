import { describe, expect, it } from "vitest";
import { HeroImportValidationError } from "@/domain/heroes";
import { parseHeroDataset } from "@/importers/dota-vpk/hero-adapter";
import { loadVpkFixture, mutateVpkFixture } from "../helpers/vpk-fixture";

const heroPath = "scripts/npc/npc_heroes.txt";

describe("VPK hero adapter", () => {
  it("maps Anti-Mage, retains CM-disabled heroes and excludes target dummy", async () => {
    const dataset = parseHeroDataset(await loadVpkFixture());
    expect(dataset.counts).toEqual({
      candidateRecords: 4,
      accepted: 2,
      expectedExclusions: 2,
      warnings: 4,
      blockingErrors: 0,
    });
    const antiMage = dataset.heroes[0];
    expect(antiMage).toMatchObject({
      heroId: 1,
      internalName: "npc_dota_hero_antimage",
      slug: "antimage",
      cmEnabled: true,
      primaryAttribute: "agility",
      attackType: "melee",
      baseStrength: "21",
    });
    expect(antiMage.localizations.map((item) => item.displayName)).toEqual([
      "Anti-Mage",
      "敌法师",
    ]);
    expect(antiMage.source.inheritedFields).toContain("StatusHealth");
    expect(dataset.heroes[1]).toMatchObject({
      heroId: 999,
      cmEnabled: false,
      primaryAttribute: "universal",
    });
    expect(
      dataset.heroes.some(
        (hero) => hero.internalName === "npc_dota_hero_target_dummy",
      ),
    ).toBe(false);
  });

  it("treats an explicit empty override as blocking instead of falling back to base", async () => {
    const files = await mutateVpkFixture(heroPath, (text) =>
      text.replace('"MovementSpeed" "310"', '"MovementSpeed" ""'),
    );
    expectValidationCode(() => parseHeroDataset(files), "invalid_decimal");
  });

  it("blocks missing localized names", async () => {
    const files = await mutateVpkFixture(
      "resource/localization/abilities_schinese.txt",
      (text) => text.replace('"npc_dota_hero_antimage:n" "敌法师"', ""),
    );
    expectValidationCode(
      () => parseHeroDataset(files),
      "missing_localized_name",
    );
  });

  it("blocks duplicate allowlist keys, duplicate IDs, unknown enums and role misalignment", async () => {
    const cases = [
      [
        '"CMEnabled" "1"',
        '"CMEnabled" "1"\n    "CMEnabled" "1"',
        "duplicate_allowlist_key",
      ],
      ['"HeroID" "999"', '"HeroID" "1"', "duplicate_identity"],
      ["DOTA_ATTRIBUTE_ALL", "DOTA_ATTRIBUTE_UNKNOWN", "unknown_enum"],
      ['"Rolelevels" "3,2"', '"Rolelevels" "3"', "misaligned_roles"],
    ] as const;
    for (const [needle, replacement, code] of cases) {
      const files = await mutateVpkFixture(heroPath, (text) =>
        text.replace(needle, replacement),
      );
      expectValidationCode(() => parseHeroDataset(files), code);
    }
  });
});

function expectValidationCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("Expected HeroImportValidationError");
  } catch (error) {
    expect(error).toBeInstanceOf(HeroImportValidationError);
    expect(
      (error as HeroImportValidationError).issues.some(
        (issue) => issue.code === code,
      ),
    ).toBe(true);
  }
}
