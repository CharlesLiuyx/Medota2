import { describe, expect, it } from "vitest";
import { parseSteamInf } from "@/importers/dota-vpk/steam";
import { canonicalJson, canonicalJsonSha256 } from "@/lib/hash";

describe("snapshot primitives", () => {
  it("parses required steam.inf versions", () => {
    expect(
      parseSteamInf("ClientVersion=6918\r\nSourceRevision=10949923\r\n"),
    ).toMatchObject({
      clientVersion: "6918",
      sourceRevision: "10949923",
    });
    expect(() => parseSteamInf("ClientVersion=1")).toThrow("SourceRevision");
  });

  it("canonicalizes flat source DTOs deterministically", () => {
    expect(canonicalJson({ z: "2", a: "1" })).toBe('{"a":"1","z":"2"}');
    expect(canonicalJsonSha256({ z: "2", a: "1" })).toBe(
      canonicalJsonSha256({ a: "1", z: "2" }),
    );
  });
});
