import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { LOCALES, localeDefinitions } from "@/i18n/config";
import { messageCatalogs } from "@/i18n/messages";
import officialTerms from "@/i18n/official-terms.json";
import englishMessageIds from "@/i18n/en.json";

const root = process.cwd();
function files(directory: string): string[] {
  return readdirSync(path.join(root, directory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const name = `${directory}/${entry.name}`;
    return entry.isDirectory()
      ? files(name)
      : /\.tsx?$/.test(name)
        ? [name]
        : [];
  });
}
const fields = (message: string) =>
  [...message.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/gu)]
    .map((match) => match[1])
    .sort();
describe("application language resources", () => {
  it("binds reviewed game vocabulary to pinned bilingual Valve tokens", () => {
    const messages = officialTerms.entries.map((entry) => entry.message);
    expect(new Set(messages).size).toBe(messages.length);
    for (const entry of officialTerms.entries) {
      expect(Object.hasOwn(englishMessageIds, entry.message)).toBe(true);
      expect(entry.token).toMatch(/^dota_/u);
      for (const locale of ["zh-CN", "en"] as const) {
        const source = officialTerms.sources.find(
          (source) =>
            source.locale === locale &&
            source.source_path.includes(`/${entry.source_family}_`),
        );
        expect(source?.source_commit).toBe(
          "f4c45719314754567cb4ef4fe343bbc790a311f4",
        );
        expect(source?.client_version).toBe("6944");
        expect(source?.raw_sha256).toMatch(/^[a-f0-9]{64}$/u);
        expect(entry.values[locale].trim()).not.toBe("");
        expect(
          (messageCatalogs[locale] as Record<string, string>)[entry.message],
        ).not.toMatch(/<|>|%s|\{[sdf]:/u);
      }
    }
    // Known official wording, including cases where the former catalog differed.
    expect(messageCatalogs["zh-CN"]["自动施法"]).toBe("自动施放");
    expect(messageCatalogs.en["自动施法"]).toBe("Auto-Cast");
    expect(messageCatalogs.en["持续施法"]).toBe("Channeled");
    expect(messageCatalogs["zh-CN"]["不可驱散"]).toBe("无法驱散");
    expect(messageCatalogs["zh-CN"]["监视者"]).toBe("观察者");
    expect(messageCatalogs["zh-CN"]["魔方"]).toBe("痛苦魔方");
    expect(messageCatalogs["zh-CN"]["肉山与魔方"]).toBe("肉山与痛苦魔方");
    expect(messageCatalogs["zh-CN"]["施法距离"]).toBe("施法距离");
    expect(messageCatalogs.en["施法距离"]).toBe("Cast Range");
    expect(messageCatalogs["zh-CN"]["驱散方式"]).toBe("能否驱散");
    expect(messageCatalogs.en["驱散方式"]).toBe("DISPELLABLE");
    expect(messageCatalogs["zh-CN"]["减益免疫"]).toBe("无视减益免疫");
    expect(messageCatalogs.en["伤害类型"]).toBe("DAMAGE TYPE");
    expect(messageCatalogs.en["英雄图鉴"]).toBe("Hero Catalog");
  });
  it("provides a complete catalog and identical interpolation fields for every enabled locale", () => {
    const keys = Object.keys(messageCatalogs.en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(messageCatalogs[locale]).sort()).toEqual(keys);
      expect(LOCALES).toContain(localeDefinitions[locale].fallback);
      for (const key of keys) {
        const translation = (messageCatalogs[locale] as Record<string, string>)[
          key
        ];
        expect(translation.trim(), `${locale}: ${key}`).not.toBe("");
        expect(fields(translation), `${locale}: ${key}`).toEqual(fields(key));
      }
    }
  });
  it("registers app, presentation and shared domain vocabulary and forbids raw Chinese JSX", () => {
    const missing: string[] = [],
      raw: string[] = [];
    const scopes = [
      ...files("src/app"),
      ...files("src/components"),
      ...files("src/presentation"),
      ...files("src/domain/map"),
      "src/domain/units.ts",
      "src/domain/items.ts",
    ];
    for (const file of scopes.filter((file) => !file.includes("/api/"))) {
      const ast = ts.createSourceFile(
        file,
        readFileSync(path.join(root, file), "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node) {
        if (
          (ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isJsxText(node)) &&
          /\p{Script=Han}/u.test(node.text)
        ) {
          const text = ts.isJsxText(node)
            ? node.text.trim().replace(/\s+/gu, " ")
            : node.text;
          const at = `${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: ${text}`;
          if (!Object.hasOwn(messageCatalogs.en, text)) missing.push(at);
          if (
            ts.isJsxText(node) &&
            (!ts.isJsxElement(node.parent) ||
              node.parent.openingElement.tagName.getText(ast) !==
                "LocalizedText")
          )
            raw.push(at);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
    expect(missing, "Unregistered UI or vocabulary messages").toEqual([]);
    expect(raw, "Use a translated message for visible JSX").toEqual([]);
  });
});
