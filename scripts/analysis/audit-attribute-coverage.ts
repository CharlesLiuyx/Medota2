import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  parseKeyValues,
  type KeyValuesObject,
} from "../../src/importers/keyvalues/parser";
import { auditNumericFields } from "../../src/domain/attribute-fields";
import { adaptItems } from "../../src/importers/dota-vpk/item-adapter";
const sourceRoot = process.argv[2];
if (!sourceRoot)
  throw new Error(
    "Usage: pnpm exec tsx scripts/analysis/audit-attribute-coverage.ts <source Git repository>",
  );
const snapshots = [];
for (const commit of [
  "991daaf6fc24b08445209d9ce8767e145bab107e",
  "f4c45719314754567cb4ef4fe343bbc790a311f4",
]) {
  const read = (file: string) =>
    execFileSync("git", ["-C", sourceRoot, "show", `${commit}:${file}`]);
  const output: Record<
    string,
    Record<
      string,
      {
        occurrences: number;
        disposition: string;
        example: string;
        source_path: string;
        line?: number;
      }
    >
  > = {};
  const enumFields: Record<string, Set<string>> = {};
  const valueCounts: Record<
    string,
    { fields: Set<string>; occurrences: number }
  > = {};
  const files: Array<{ source_path: string; sha256: string }> = [];
  function capture(
    kind: string,
    fields: KeyValuesObject,
    owner: string,
    file: string,
  ) {
    const rows = (output[kind] ??= {});
    for (const field of auditNumericFields(fields)) {
      const row = (rows[field.key] ??= {
        occurrences: 0,
        disposition: field.excluded ?? "attribute-or-owner-parameter",
        example: owner,
        source_path: file,
        line: field.line,
      });
      row.occurrences++;
    }
    for (const e of fields.entries) {
      if (
        typeof e.value === "string" &&
        /^(?:DOTA_|SPELL_|DAMAGE_)/.test(e.value)
      )
        (enumFields[e.key] ??= new Set()).add(e.value);
      if (e.key === "AbilityDefinitions" && typeof e.value === "object")
        for (const a of e.value.entries)
          if (typeof a.value === "object")
            capture("ability", a.value, a.key, file);
      if (
        ["AbilityValues", "AbilitySpecial"].includes(e.key) &&
        typeof e.value === "object"
      ) {
        const c = (valueCounts[kind] ??= { fields: new Set(), occurrences: 0 });
        for (const v of e.value.entries) {
          if (e.key === "AbilitySpecial" && typeof v.value === "object")
            for (const legacy of v.value.entries) {
              if (legacy.key !== "var_type") {
                c.fields.add(legacy.key);
                c.occurrences++;
              }
            }
          else {
            c.fields.add(v.key);
            c.occurrences++;
          }
        }
      }
    }
  }
  const inputFiles = [
    ["npc_units.txt", "unit"],
    ["items.txt", "item"],
    ["npc_abilities.txt", "ability"],
    ["npc_heroes.txt", "hero"],
  ];
  const heroFiles = execFileSync(
    "git",
    [
      "-C",
      sourceRoot,
      "ls-tree",
      "-r",
      "--name-only",
      commit,
      "scripts/npc/heroes",
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter((f) => f.endsWith(".txt"));
  inputFiles.push(
    ...heroFiles.map((f) => [f.replace("scripts/npc/", ""), "hero"]),
  );
  let itemValues = 0;
  for (const [file, kind] of inputFiles) {
    const source_path = "scripts/npc/" + file;
    const raw = read(source_path);
    files.push({
      source_path,
      sha256: createHash("sha256").update(raw).digest("hex"),
    });
    const parsed = parseKeyValues(raw.toString());
    const base = parsed.entries.find((e) => typeof e.value === "object")?.value;
    if (typeof base !== "object") continue;
    for (const e of base.entries)
      if (typeof e.value === "object")
        capture(
          kind === "hero" && !e.key.startsWith("npc_dota_hero_")
            ? "ability"
            : kind,
          e.value,
          e.key,
          source_path,
        );
    if (kind === "item") {
      const adapted = adaptItems(raw.toString(), {}, {});
      for (const item of adapted.items) {
        const source = base.entries.find(
          (e) => e.key === item.internalName,
        )?.value;
        if (typeof source !== "object") continue;
        const values = source.entries.find(
          (e) => e.key === "AbilityValues",
        )?.value;
        if (typeof values !== "object") continue;
        for (const field of values.entries) {
          const hasValue =
            typeof field.value === "string" ||
            field.value.entries.some(
              (e) => e.key === "value" && typeof e.value === "string",
            );
          if (hasValue) {
            itemValues++;
            if (!item.stats.some((s) => s.key === field.key.toLowerCase()))
              throw new Error(
                "Uncovered item value " + item.internalName + "/" + field.key,
              );
          }
        }
      }
    }
  }
  snapshots.push({
    source_commit: commit,
    client_version: /ClientVersion=(\d+)/.exec(
      read("steam.inf").toString(),
    )?.[1],
    source_repository:
      "https://github.com/spirit-bear-productions/dota_vpk_updates",
    files,
    root_numeric_fields: Object.fromEntries(
      Object.entries(output).map(([kind, rows]) => [
        kind,
        Object.fromEntries(
          Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)),
        ),
      ]),
    ),
    enum_fields: Object.fromEntries(
      Object.entries(enumFields).map(([key, values]) => [
        key,
        [...values].sort(),
      ]),
    ),
    value_blocks: Object.fromEntries(
      Object.entries(valueCounts).map(([kind, v]) => [
        kind,
        { distinct_fields: v.fields.size, occurrences: v.occurrences },
      ]),
    ),
    item_ability_values_checked: itemValues,
    uncovered_item_ability_values: 0,
  });
}
fs.writeFileSync(
  "docs/data/attribute-coverage-7.41e-7.41f.json",
  JSON.stringify(
    {
      schema_version: "attribute-coverage-v1",
      importer_version: "attribute-field-audit-v1",
      imported_at: new Date().toISOString(),
      scope:
        "Numeric root fields and AbilityValues/AbilitySpecial in fixed VPK source definitions. Presentation, identity and boolean behavior fields remain source metadata. No assertion of complete engine mechanism coverage.",
      snapshots,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  snapshots.map((s) => ({
    commit: s.source_commit,
    roots: Object.fromEntries(
      Object.entries(s.root_numeric_fields).map(([k, v]) => [
        k,
        Object.keys(v).length,
      ]),
    ),
    values: s.value_blocks,
    itemValues: s.item_ability_values_checked,
  })),
);
