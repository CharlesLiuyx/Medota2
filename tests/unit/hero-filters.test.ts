import { describe, expect, it } from "vitest";
import { parseHeroFilters } from "@/server/services/hero-filters";

describe("hero query contract", () => {
  it("normalizes search and sorts repeated values", () => {
    const parsed = parseHeroFilters({
      q: "  Ａnti-Mage  ",
      attribute: ["universal", "agility", "agility"],
      role: ["support", "carry"],
      attack: "melee",
      cm: "false",
    });
    expect(parsed.errors).toEqual([]);
    expect(parsed.filters).toEqual({
      q: "anti-mage",
      attributes: ["agility", "universal"],
      roles: ["carry", "support"],
      attacks: ["melee"],
      cm: "false",
    });
  });

  it("makes unknown values and duplicate single-value params visible", () => {
    const parsed = parseHeroFilters({
      attribute: "luck",
      cm: ["true", "false"],
      surprise: "1",
    });
    expect(parsed.errors).toHaveLength(3);
  });
});
