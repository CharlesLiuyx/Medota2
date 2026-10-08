import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseHeroDataset } from "../../src/importers/dota-vpk/hero-adapter";
import { parseAbilityDataset } from "../../src/importers/dota-vpk/ability-adapter";
import { CATALOG_STATIC_SOURCE_PATHS } from "../../src/importers/dota-vpk/constants";
import { unitTokens } from "../../src/importers/dota-vpk/unit-adapter";
import { attributeId } from "../../src/domain/attributes";
import { valueLabel } from "../../src/presentation/dota";
import type { SourceFields } from "../../src/domain/attribute-fields";

// Each emitted binding is reviewed vocabulary + a field in a pinned VPK snapshot.
// No runtime translation of keys, approximate owner matching or cross-version fallback.
const root = process.argv[2];
if (!root) throw new Error("Provide a read-only source Git repository");
const directory = "src/data/attribute-parameters";
const sha = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
function vocabulary(file: string) {
  const result = new Map<string, { zh: string; en: string }>();
  for (const line of readFileSync(`${directory}/${file}`, "utf8")
    .split("\n")
    .filter(Boolean)) {
    const [key, zh, en, extra] = line.split("\t");
    if (!key || !zh || !en || extra !== undefined || result.has(key))
      throw new Error(`Invalid or duplicate reviewed label: ${line}`);
    result.set(key, { zh, en });
  }
  return result;
}
const common = vocabulary("reviewed-labels.tsv");
const overrides = vocabulary("owner-overrides.tsv");
const usedOverrides = new Set<string>();
const contextual = new Map<
  string,
  { zh: string; en: string; confidence: string; rationale: string }
>();
for (const line of readFileSync(`${directory}/contextual-labels.tsv`, "utf8")
  .split("\n")
  .filter(Boolean)) {
  const [key, zh, en, confidence, rationale, extra] = line.split("\t");
  if (
    !key ||
    !zh ||
    !en ||
    !rationale ||
    extra !== undefined ||
    !["high", "medium", "low"].includes(confidence) ||
    contextual.has(key) ||
    overrides.has(key)
  )
    throw new Error(`Invalid contextual label: ${line}`);
  contextual.set(key, { zh, en, confidence, rationale });
}
const usedContextual = new Set<string>();
type TextEvidence = {
  sourcePath: string;
  line: number;
  token: string;
  commented: boolean;
  excerpt: string;
};
function localizationRows(text: string, sourcePath: string) {
  return text.split(/\r?\n/).flatMap((line, i) => {
    const match = /^\s*(\/\/\s*)?"([^"]+)"\s+"(.*)"/u.exec(line);
    return match
      ? [
          {
            sourcePath,
            line: i + 1,
            token: match[2].toLowerCase(),
            commented: Boolean(match[1]),
            excerpt: match[3],
          },
        ]
      : [];
  });
}
function fieldLine(source: SourceFields, field: string): number | undefined {
  const blocks = source.entries.filter((e) =>
    ["AbilityValues", "AbilitySpecial"].includes(e.key),
  );
  for (const block of blocks) {
    if (typeof block.value === "string") continue;
    for (const entry of block.value.entries) {
      if (entry.key === field) return entry.line;
      if (block.key === "AbilitySpecial" && typeof entry.value !== "string") {
        const nested = entry.value.entries.find((e) => e.key === field);
        if (nested) return nested.line;
      }
    }
  }
}
const parameters: Record<string, { zh: string; en: string }> = {};
const snapshots = [];
const audits = [];
for (const commit of [
  "991daaf6fc24b08445209d9ce8767e145bab107e",
  "f4c45719314754567cb4ef4fe343bbc790a311f4",
]) {
  const git = (args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { maxBuffer: 32 * 1024 * 1024 });
  const heroPaths = git([
    "ls-tree",
    "-r",
    "--name-only",
    commit,
    "scripts/npc/heroes",
  ])
    .toString()
    .trim()
    .split("\n")
    .filter((p) => p.endsWith(".txt"));
  const files = [...CATALOG_STATIC_SOURCE_PATHS, ...heroPaths].map((path) => {
    const bytes = git(["show", `${commit}:${path}`]);
    return {
      path,
      bytes,
      text: bytes.toString("utf8"),
      sha256: sha(bytes),
      sizeBytes: bytes.length,
      encoding: "utf-8" as const,
    };
  });
  const heroes = parseHeroDataset(files);
  const abilities = parseAbilityDataset(files, heroes.heroes).abilities;
  const byName = new Map(abilities.map((a) => [a.internalName, a]));
  const names = abilities
    .map((a) => a.internalName)
    .sort((a, b) => b.length - a.length);
  const localized = files.filter((f) =>
    /abilities_(english|schinese)\.txt$/u.test(f.path),
  );
  const texts = localized.flatMap((f) => localizationRows(f.text, f.path));
  const tokens = localized.map((f) => unitTokens(f.text));
  const en = tokens[0],
    zh = tokens[1];
  const ownerText = new Map<string, TextEvidence[]>();
  for (const text of texts) {
    if (!text.token.startsWith("dota_tooltip_ability_")) continue;
    const stem = text.token.slice("dota_tooltip_ability_".length);
    const name = names.find((n) => stem.startsWith(`${n}_`));
    if (name) {
      const rows = ownerText.get(name) ?? [];
      rows.push(text);
      ownerText.set(name, rows);
    }
  }
  function definition(
    owner: string,
    field: string,
    seen = new Set<string>(),
  ): { sourcePath: string; line: number } {
    const ability = byName.get(owner);
    if (!ability || seen.has(owner))
      throw new Error(`Missing definition: ${owner}.${field}`);
    seen.add(owner);
    for (const occurrence of [
      ...ability.source.definitionOccurrences,
    ].reverse()) {
      if (typeof occurrence.rawDefinition === "string") continue;
      const line = fieldLine(occurrence.rawDefinition, field);
      if (line) return { sourcePath: occurrence.path, line };
    }
    if (ability.baseClass && byName.has(ability.baseClass))
      return definition(ability.baseClass, field, seen);
    // Implicit talent declarations have a scalar value, not an AbilityValues block.
    return { sourcePath: ability.source.path, line: ability.source.line };
  }
  const evidence: Record<
    string,
    {
      definition: { sourcePath: string; line: number };
      kind: string;
      labels: TextEvidence[];
      references: TextEvidence[];
      context?: {
        model: string;
        confidence: string;
        rationale: string;
      };
    }
  > = {};
  const contextSources: Record<string, TextEvidence[]> = {};
  const unresolved = [];
  let missingBefore = 0;
  for (const ability of abilities)
    for (const value of ability.values) {
      const owner = ability.internalName,
        field = value.valueKey;
      const token = `dota_tooltip_ability_${owner}_${field}`.toLowerCase();
      const id = attributeId("ability", owner, field, zh[token] || en[token]);
      if (
        !id.includes("~") ||
        (valueLabel(field, zh[token], "zh-CN", zh) &&
          valueLabel(field, en[token], "en", en))
      )
        continue;
      missingBefore++;
      const key = `${owner}.${field}`;
      const inferred = contextual.get(key);
      if (inferred && common.has(field))
        throw new Error(`Contextual label replaces reviewed field: ${key}`);
      const label = overrides.get(key) ?? common.get(field) ?? inferred;
      const candidates = ownerText.get(owner) ?? [];
      const labels = candidates.filter(
        (t) => t.token === token || t.token.startsWith(`${token}:`),
      );
      const reference = new RegExp(
        `%${field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}%|\\{s:${field.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\}`,
        "iu",
      );
      const references = candidates
        .filter(
          (t) =>
            !t.commented &&
            /description|note\d*|facet_/u.test(t.token) &&
            reference.test(t.excerpt),
        )
        .map((t) => {
          const match = reference.exec(t.excerpt)!;
          return {
            ...t,
            excerpt: t.excerpt.slice(
              Math.max(0, match.index - 65),
              match.index + match[0].length + 85,
            ),
          };
        });
      const basis = {
        definition: definition(owner, field),
        labels,
        references,
      };
      if (!label) {
        unresolved.push({
          id,
          owner,
          field,
          ...basis,
          reason:
            "No reviewed precise label; field definition alone does not resolve effect, unit or direction.",
        });
        continue;
      }
      if (overrides.has(key)) usedOverrides.add(key);
      if (inferred) {
        usedContextual.add(key);
        contextSources[owner] ??= texts
          .filter(
            (t) =>
              t.token === `dota_tooltip_ability_${owner}` ||
              (candidates.includes(t) &&
                !t.commented &&
                /description|note\d*|facet_/u.test(t.token)),
          )
          .map((t) => ({ ...t, excerpt: t.excerpt.slice(0, 700) }));
      }
      if (
        parameters[key] &&
        JSON.stringify(parameters[key]) !==
          JSON.stringify({ zh: label.zh, en: label.en })
      )
        throw new Error(`Conflicting label: ${key}`);
      parameters[key] = { zh: label.zh, en: label.en };
      evidence[key] = {
        ...basis,
        ...(inferred
          ? {
              context: {
                model: "gpt-6-luna",
                confidence: inferred.confidence,
                rationale: inferred.rationale,
              },
            }
          : {}),
        kind: inferred
          ? "context-inference"
          : labels.length
            ? labels.some((t) => !t.commented)
              ? "official-label"
              : "commented-label"
            : references.length
              ? "description"
              : "definition",
      };
    }
  const client_version = files
    .find((f) => f.path === "steam.inf")!
    .text.match(/^ClientVersion=(.+)$/mu)?.[1]
    .trim();
  if (!client_version) throw new Error("Missing client version");
  const sourceFiles = files.map((f) => ({
    source_path: f.path,
    raw_sha256: f.sha256,
  }));
  snapshots.push({
    source_commit: commit,
    client_version,
    missingBefore,
    named: Object.keys(evidence).length,
    unresolved: unresolved.length,
    files: sourceFiles,
    evidence,
    contextSources,
  });
  audits.push({
    source_commit: commit,
    client_version,
    missingBefore,
    named: Object.keys(evidence).length,
    unresolved,
  });
  console.log({
    commit,
    missingBefore,
    named: Object.keys(evidence).length,
    unresolved: unresolved.length,
  });
}
for (const key of overrides.keys())
  if (!usedOverrides.has(key))
    throw new Error(
      `Owner binding not present in either pinned snapshot: ${key}`,
    );
for (const key of contextual.keys())
  if (!usedContextual.has(key))
    throw new Error(
      `Contextual binding not present in pinned snapshots: ${key}`,
    );
const payload = { parameters, snapshots };
const auditPayload = { snapshots: audits };
if (process.argv.includes("--check")) {
  for (const [file, content] of [
    ["supplement.v1.json", payload],
    ["unresolved.v1.json", auditPayload],
  ] as const) {
    const stored = JSON.parse(readFileSync(`${directory}/${file}`, "utf8"));
    const saved =
      file === "supplement.v1.json"
        ? { parameters: stored.parameters, snapshots: stored.snapshots }
        : { snapshots: stored.snapshots };
    if (
      stored.contentSha256 !== sha(JSON.stringify(content)) ||
      stored.contentSha256 !== sha(JSON.stringify(saved))
    )
      throw new Error(`Pinned evidence or labels differ: ${file}`);
  }
} else {
  const metadata = {
    source_repository:
      "https://github.com/spirit-bear-productions/dota_vpk_updates",
    imported_at: new Date().toISOString(),
    importer_version: "reviewed-attribute-parameters-v2",
    schema_version: "attribute-parameter-labels-v2",
  };
  for (const [file, content] of [
    ["supplement.v1.json", payload],
    ["unresolved.v1.json", auditPayload],
  ] as const)
    writeFileSync(
      `${directory}/${file}`,
      JSON.stringify(
        {
          ...metadata,
          contentSha256: sha(JSON.stringify(content)),
          ...content,
        },
        null,
        2,
      ) + "\n",
    );
}
