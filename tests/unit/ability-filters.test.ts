import { describe, expect, it } from "vitest";
import {
  canonicalAbilityQuery,
  isCanonicalAbilityQuery,
  parseAbilityFilters,
} from "@/server/services/ability-filters";

describe("ability query contract", () => {
  it("normalizes filters without exposing page state", () => {
    const parsed = parseAbilityFilters({
      q: "  Ｂlink  ",
      status: "all",
      hero: "npc_dota_hero_antimage",
      relation: "loadout",
      lang: "en",
    });

    expect(parsed.errors).toEqual([]);
    expect(parsed.filters).toEqual({
      q: "blink",
      status: "all",
      hero: "npc_dota_hero_antimage",
      relation: "loadout",
      behavior: "",
      damage: "",
      upgrade: "all",
      lang: "en",
    });
    expect(canonicalAbilityQuery(parsed.filters)).not.toContain("page=");
  });

  it("accepts a valid legacy page only so canonicalization can remove it", () => {
    const raw = { q: "blink", page: "27" };
    const parsed = parseAbilityFilters(raw);

    expect(parsed.errors).toEqual([]);
    expect(parsed.filters).not.toHaveProperty("page");
    expect(canonicalAbilityQuery(parsed.filters)).toBe("q=blink");
    expect(isCanonicalAbilityQuery(raw, parsed.filters)).toBe(false);
  });

  it.each(["0", "01", "1.5", "10001", "nope"])(
    "rejects an invalid legacy page value %s",
    (page) => {
      expect(parseAbilityFilters({ page }).errors).toContain(
        `无效页码：${page}`,
      );
    },
  );

  it("rejects repeated legacy page values", () => {
    expect(parseAbilityFilters({ page: ["1", "2"] }).errors).toContain(
      "page 只允许一个值。",
    );
  });
});
