import { expect, it } from "vitest";
import { adaptUnits, unitTokens } from "@/importers/dota-vpk/unit-adapter";
const source = (extra: string) =>
  `"DOTAUnits" { "npc_dota_units_base" { "StatusHealth" "150" "MovementSpeed" "300" "Ability1" "" } ${extra} }`;
it("resolves explicit inheritance and overrides while retaining unknown source fields", () => {
  const result = adaptUnits(
    source(
      `"wolf" { "BaseClass" "npc_dota_creep_neutral" "IsSummoned" "1" "StatusHealth" "325" "Ability1" "bite" "future_key" "kept" } "wolf2" { "include_keys_from" "wolf" "StatusHealth" "375" "Level" "2" }`,
    ),
    { wolf: "精灵狼" },
    { wolf: "Spirit Wolf" },
  );
  const wolf = result.units.find((unit) => unit.internalName === "wolf2")!;
  expect(wolf.stats.StatusHealth).toBe("375");
  expect(wolf.stats.MovementSpeed).toBe("300");
  expect(wolf.abilities).toEqual(["bite"]);
  expect(wolf.category).toBe("summon");
  expect(wolf.zhName).toBe("精灵狼");
  expect(JSON.stringify(result.raw)).toContain("future_key");
});
it("rejects duplicate identities, missing parents and cycles", () => {
  for (const entries of [
    '"a" {} "a" {}',
    '"a" { "include_keys_from" "missing" }',
    '"a" { "include_keys_from" "b" } "b" { "include_keys_from" "a" }',
  ])
    expect(() => adaptUnits(source(entries), {}, {})).toThrow();
});
it("handles localization case, missing values and placeholders without inventing names or numbers", () => {
  const tokens = unitTokens('"lang" { "Tokens" { "NPC_DOTA_ROSHAN" "肉山" } }');
  const units = adaptUnits(
    source(
      '"npc_dota_roshan" { "StatusHealth" "6000" "MovementSpeed" "unknown" } "npc_dota_roshan_halloween" {}',
    ),
    tokens,
    {},
  ).units;
  expect(units[0]).toMatchObject({
    zhName: "肉山",
    category: "boss",
    stats: { StatusHealth: "6000", MovementSpeed: null },
  });
  expect(units[1]).toMatchObject({ category: "event", zhName: "名称待补充" });
  expect(
    adaptUnits(source('"a" {}'), { a: "小%s1" }, {}).units.find(
      (u) => u.internalName === "a",
    )?.zhName,
  ).toBe("名称待补充");
});
