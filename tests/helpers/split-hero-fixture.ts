import type { CheckedSourceFile } from "@/importers/git-checkout";
import {
  parseKeyValues,
  uniqueObject,
  type KeyValuesObject,
} from "@/importers/keyvalues/parser";
import { sha256 } from "@/lib/hash";
import { loadCatalogFixture } from "./vpk-fixture";

function serialize(object: KeyValuesObject): string {
  return object.entries
    .map(
      ({ key, value }) =>
        `${JSON.stringify(key)} ${typeof value === "string" ? JSON.stringify(value) : `{\n${serialize(value)}\n}`}`,
    )
    .join("\n");
}
export async function loadSplitHeroFixture(): Promise<CheckedSourceFile[]> {
  const files = await loadCatalogFixture();
  const source = files.find((f) => f.path === "scripts/npc/npc_heroes.txt")!;
  const root = uniqueObject(parseKeyValues(source.text), "DOTAHeroes");
  const checked = (path: string, text: string): CheckedSourceFile => {
    const bytes = Buffer.from(text);
    return {
      path,
      text,
      bytes,
      sha256: sha256(bytes),
      sizeBytes: bytes.length,
      encoding: "utf-8",
    };
  };
  const split = root.entries
    .filter((e) => e.key.startsWith("npc_dota_hero_"))
    .map((entry) => {
      const path = `scripts/npc/heroes/${entry.key}.txt`;
      const abilities = files.find((f) => f.path === path);
      const object = entry.value as KeyValuesObject;
      const value = {
        entries: [
          ...object.entries,
          ...(abilities
            ? [
                {
                  key: "AbilityDefinitions",
                  value: uniqueObject(
                    parseKeyValues(abilities.text),
                    "DOTAAbilities",
                  ),
                  line: 1,
                },
              ]
            : []),
        ],
      };
      return checked(
        path,
        serialize({
          entries: [
            {
              key: "DOTAHeroes",
              value: { entries: [{ ...entry, value }] },
              line: 1,
            },
          ],
        }),
      );
    });
  const includes = split
    .map(
      (file) =>
        `#base ${JSON.stringify(file.path.replace("scripts/npc/", ""))}`,
    )
    .join("\n");
  return [
    ...files.filter(
      (f) =>
        f.path !== source.path &&
        !split.some((newFile) => newFile.path === f.path),
    ),
    checked(source.path, `${includes}\n"DOTAHeroes" { "Version" "1" }`),
    ...split,
  ];
}
