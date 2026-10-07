import { expect, it } from "vitest";
import { keyValuesData, withoutSourceLayout } from "@/importers/keyvalues/data";
import { parseKeyValues } from "@/importers/keyvalues/parser";

it("ignores KV layout while retaining duplicate values and explicit empty values", () => {
  const a = keyValuesData(
    parseKeyValues('"speed" "300"\n"mana" ""\n"bonus" "1"\n"bonus" "2"'),
  );
  const b = keyValuesData(
    parseKeyValues(
      '// moved lines\n\n"mana" "" "speed" "300" "bonus" "1" "bonus" "2"',
    ),
  );
  expect(a).toEqual(b);
  expect(a).toEqual({
    speed: "300",
    mana: "",
    bonus: { occurrences: ["1", "2"] },
  });
  expect(keyValuesData(parseKeyValues('"bonus" "2" "bonus" "1"'))).not.toEqual({
    bonus: a.bonus,
  });
  expect(
    withoutSourceLayout({
      modifiers: [{ key: "talent", value: "10", line: 40 }],
    }),
  ).toEqual({ modifiers: [{ key: "talent", value: "10" }] });
});
