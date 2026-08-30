import { describe, expect, it } from "vitest";
import {
  objectEntries,
  parseKeyValues,
  uniqueObject,
} from "@/importers/keyvalues/parser";

describe("KeyValues parser", () => {
  it("handles comments, empty values, escapes, bare values and repeated keys", () => {
    const parsed = parseKeyValues(`
      // line comment
      "root" { "empty" "" bare value "quote" "a\\\"b" /* block */ "same" "1" "same" "2" }
    `);
    const root = uniqueObject(parsed, "root");
    expect(objectEntries(root, "empty")[0].value).toBe("");
    expect(objectEntries(root, "bare")[0].value).toBe("value");
    expect(objectEntries(root, "quote")[0].value).toBe('a"b');
    expect(objectEntries(root, "same")).toHaveLength(2);
  });

  it("rejects malformed nesting", () => {
    expect(() => parseKeyValues('"root" { "key" "value"')).toThrow(
      "Missing closing brace",
    );
  });
});
