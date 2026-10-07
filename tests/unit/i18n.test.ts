import { diagnosticText } from "@/i18n/diagnostics";
import { formatNumber } from "@/i18n/format";
import { describe, expect, it } from "vitest";
import { resolveLocale, withLocale } from "@/i18n/locale";
import { translate } from "@/i18n/messages";

describe("global locale", () => {
  it("resolves explicit links before preferences and validates unsupported values", () => {
    expect(resolveLocale("zh-CN", "en")).toBe("zh-CN");
    expect(resolveLocale(undefined, "en")).toBe("en");
    expect(resolveLocale("fr", "en")).toBe("en");
    expect(resolveLocale(["en", "zh-CN"], "invalid")).toBe("zh-CN");
  });
  it("preserves release, filters, anchors and explicit language without altering external or data links", () => {
    expect(withLocale("/heroes?q=axe&release=c%3A123#stats", "en")).toBe(
      "/heroes?q=axe&release=c%3A123&lang=en#stats",
    );
    expect(withLocale("/map?lang=zh-CN", "en")).toBe("/map?lang=zh-CN");
    expect(withLocale("/heroes?lang=en", "zh-CN", true)).toBe(
      "/heroes?lang=zh-CN",
    );
    for (const url of [
      "https://example.com",
      "//example.com",
      "#stats",
      "/api/catalog/heroes",
      "/map/assets/overview.webp",
      "/valve-assets/hero/axe",
      "/icon.svg",
    ])
      expect(withLocale(url, "en")).toBe(url);
  });
  it("formats interpolated quantities and compound diagnostics at the display boundary", () => {
    expect(formatNumber("en", 12345.5)).toBe("12,345.5");
    expect(translate("en", "{value0} 金币", { value0: 12345 })).toContain(
      "12,345",
    );
    expect(
      diagnosticText(
        "en",
        "版本没有共同资料覆盖。；覆盖不完整，无法确认实体新增或删除。",
      ),
    ).not.toMatch(/\p{Script=Han}/u);
  });
  it("translates common UI while preserving source text without a translation", () => {
    expect(translate("en", "英雄图鉴")).toBe("Hero Catalog");
    expect(translate("zh-CN", "英雄图鉴")).toBe("英雄图鉴");
    expect(translate("en", "未迁移文案")).toBe("未迁移文案");
  });
});
