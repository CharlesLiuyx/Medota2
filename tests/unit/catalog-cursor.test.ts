import { describe, expect, it } from "vitest";
import {
  assertListCursorMatches,
  createListFilterIdentity,
  decodeListCursor,
  encodeListCursor,
  type AbilityListCursor,
  type HeroListCursor,
} from "@/server/services/catalog-cursor";

const catalogDatasetVersionId = "11111111-1111-4111-8111-111111111111";
const assetDatasetVersionId = "22222222-2222-4222-8222-222222222222";
const filterIdentity = createListFilterIdentity("lang=zh-CN&q=%E9%9B%B7");

describe("list cursor codec", () => {
  it("round-trips an Ability Unicode sort tuple", () => {
    const cursor: AbilityListCursor = {
      version: 1,
      entityKind: "abilities",
      catalogDatasetVersionId,
      assetDatasetVersionId,
      locale: "zh-CN",
      filterIdentity,
      sort: ["雷神之怒 ⚡", "zuus_thundergods_wrath"],
    };

    const decoded = decodeListCursor(encodeListCursor(cursor));

    expect(decoded).toEqual(cursor);
    expect(() =>
      assertListCursorMatches(decoded, {
        entityKind: "abilities",
        locale: "zh-CN",
        filterIdentity,
        catalogDatasetVersionId,
        assetDatasetVersionId,
      }),
    ).not.toThrow();
  });

  it("round-trips the Hero attribute-rank and ID tuple", () => {
    const cursor: HeroListCursor = {
      version: 1,
      entityKind: "heroes",
      catalogDatasetVersionId,
      assetDatasetVersionId,
      locale: "en",
      filterIdentity,
      sort: [3, 145],
    };

    expect(decodeListCursor(encodeListCursor(cursor))).toEqual(cursor);
  });

  it.each([
    ["entity kind", { entityKind: "heroes" as const }],
    ["locale", { locale: "en" as const }],
    ["filter", { filterIdentity: "0".repeat(64) }],
    [
      "catalog dataset",
      {
        catalogDatasetVersionId: "33333333-3333-4333-8333-333333333333",
      },
    ],
    [
      "asset dataset",
      {
        assetDatasetVersionId: "44444444-4444-4444-8444-444444444444",
      },
    ],
  ])("rejects a mismatched %s identity", (_label, override) => {
    const cursor: AbilityListCursor = {
      version: 1,
      entityKind: "abilities",
      catalogDatasetVersionId,
      assetDatasetVersionId,
      locale: "zh-CN",
      filterIdentity,
      sort: ["Blink", "antimage_blink"],
    };
    const expected = {
      entityKind: "abilities" as const,
      locale: "zh-CN" as const,
      filterIdentity,
      catalogDatasetVersionId,
      assetDatasetVersionId,
      ...override,
    };

    expect(() => assertListCursorMatches(cursor, expected)).toThrowError(
      expect.objectContaining({ code: "stream_mismatch" }),
    );
  });

  it.each([
    "",
    "not+base64url",
    "a".repeat(4_097),
    Buffer.from("{", "utf8").toString("base64url"),
    Buffer.from(
      JSON.stringify({
        version: 1,
        entityKind: "heroes",
        catalogDatasetVersionId,
        assetDatasetVersionId,
        locale: "en",
        filterIdentity,
        sort: [4, 1],
      }),
      "utf8",
    ).toString("base64url"),
    Buffer.from(
      JSON.stringify({
        version: 1,
        entityKind: "abilities",
        catalogDatasetVersionId,
        assetDatasetVersionId,
        locale: "en",
        filterIdentity,
        sort: ["Blink", "antimage_blink"],
        extra: true,
      }),
      "utf8",
    ).toString("base64url"),
  ])("rejects malformed or non-strict cursor input", (encoded) => {
    expect(() => decodeListCursor(encoded)).toThrowError(
      expect.objectContaining({ code: "invalid_cursor" }),
    );
  });
});
