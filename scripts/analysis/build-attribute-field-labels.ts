import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseHeroDataset } from "../../src/importers/dota-vpk/hero-adapter";
import { parseAbilityDataset } from "../../src/importers/dota-vpk/ability-adapter";
import { parseKeyValues } from "../../src/importers/keyvalues/parser";
import { HERO_ATTRIBUTE_FIELDS } from "../../src/domain/attributes";
import {
  resolvedUnitAttributeFields,
  type SourceFields,
} from "../../src/domain/attribute-fields";

const repository = process.argv[2];
if (!repository) throw new Error("Provide a read-only source Git repository");
const directory = "src/data/attribute-parameters";
const sha = (data: string | Buffer) =>
  createHash("sha256").update(data).digest("hex");
interface Binding {
  kind: string;
  field: string;
  owners: string[];
  samples: Array<{
    owner: string;
    sourcePath: string;
    sourceLine?: number | null;
  }>;
}
function hasField(source: SourceFields, key: string): boolean {
  return (
    source.entries.some((entry) => entry.key === key) ||
    source.entries
      .filter((entry) =>
        ["AbilityValues", "AbilitySpecial"].includes(entry.key),
      )
      .some(
        (entry) =>
          typeof entry.value !== "string" &&
          (entry.value.entries.some((value) => value.key === key) ||
            (entry.key === "AbilitySpecial" &&
              entry.value.entries.some(
                (value) =>
                  typeof value.value !== "string" &&
                  value.value.entries.some((field) => field.key === key),
              ))),
      )
  );
}
const inventory = JSON.parse(
  readFileSync(`${directory}/field-bindings.v1.json`, "utf8"),
) as {
  source_repository: string;
  snapshots: Array<{
    source_commit: string;
    client_version: string;
    rawTitleCount: number;
    rawRelationCount: number;
    bindings: Record<string, Binding>;
  }>;
};
const known = JSON.parse(
  readFileSync(`${directory}/supplement.v1.json`, "utf8"),
) as {
  snapshots: Array<{
    source_commit: string;
    client_version: string;
    files: Array<{ source_path: string; raw_sha256: string }>;
  }>;
};
const expected = new Set(
  inventory.snapshots.flatMap((s) => Object.keys(s.bindings)),
);
const labels: Record<
  string,
  { zh: string; confidence: string; rationale: string }
> = {};
for (const line of readFileSync(`${directory}/field-labels.tsv`, "utf8")
  .split("\n")
  .filter(Boolean)) {
  const [key, zh, confidence, rationale, extra] = line.split("\t");
  if (
    !expected.has(key) ||
    labels[key] ||
    !zh ||
    !rationale ||
    extra !== undefined ||
    !/\p{Script=Han}/u.test(zh) ||
    !["high", "medium", "low"].includes(confidence)
  )
    throw new Error(`Invalid field name: ${line}`);
  labels[key] = { zh, confidence, rationale };
}
if (Object.keys(labels).length !== expected.size)
  throw new Error("Field name coverage is incomplete");
const snapshots = inventory.snapshots.map((snapshot) => {
  const pinned = known.snapshots.find(
    (s) => s.source_commit === snapshot.source_commit,
  );
  if (!pinned || pinned.client_version !== snapshot.client_version)
    throw new Error("Unknown source/client version");
  const files = [
    ...new Set([
      ...pinned.files.map((f) => f.source_path),
      "scripts/npc/items.txt",
      "scripts/npc/npc_units.txt",
    ]),
  ].map((path) => {
    const bytes = execFileSync(
      "git",
      ["-C", repository, "show", `${snapshot.source_commit}:${path}`],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    const checksum = sha(bytes);
    const previous = pinned.files.find((f) => f.source_path === path);
    if (previous && previous.raw_sha256 !== checksum)
      throw new Error(`Changed pinned source: ${path}`);
    return {
      path,
      bytes,
      text: bytes.toString("utf8"),
      sha256: checksum,
      sizeBytes: bytes.length,
      encoding: "utf-8" as const,
    };
  });
  const textByPath = new Map(files.map((f) => [f.path, f.text]));
  const client = textByPath
    .get("steam.inf")
    ?.match(/^ClientVersion=(.+)$/mu)?.[1]
    .trim();
  if (client !== snapshot.client_version)
    throw new Error("Client version differs from steam.inf");
  const heroes = parseHeroDataset(files);
  const heroNames = new Set(heroes.heroes.map((h) => h.internalName));
  const abilitySources = new Map(
    parseAbilityDataset(files, heroes.heroes).abilities.map((a) => [
      a.internalName,
      a.source.resolvedDefinition,
    ]),
  );
  const root = (path: string, key: string): SourceFields => {
    const value = parseKeyValues(textByPath.get(path)!).entries.find(
      (e) => e.key === key,
    )?.value;
    if (!value || typeof value === "string")
      throw new Error(`Missing source root: ${path}`);
    return value;
  };
  const units = resolvedUnitAttributeFields(
    root("scripts/npc/npc_units.txt", "DOTAUnits"),
  );
  const items = new Map(
    root("scripts/npc/items.txt", "DOTAAbilities").entries.map((e) => [
      e.key,
      e.value,
    ]),
  );
  let verifiedBindings = 0;
  for (const [key, binding] of Object.entries(snapshot.bindings)) {
    if (
      !binding.owners.length ||
      new Set(binding.owners).size !== binding.owners.length
    )
      throw new Error(`Duplicate/empty owners: ${key}`);
    for (const owner of binding.owners) {
      if (
        key !== `${binding.kind}.${binding.field}` &&
        key !== `${binding.kind}.${owner}.${binding.field}`
      )
        throw new Error(`Invalid identity: ${key}`);
      const source =
        binding.kind === "ability"
          ? abilitySources.get(owner)
          : binding.kind === "unit"
            ? units.get(owner)
            : binding.kind === "item"
              ? items.get(owner)
              : undefined;
      const valid =
        binding.kind === "hero"
          ? heroNames.has(owner) &&
            Object.hasOwn(HERO_ATTRIBUTE_FIELDS, binding.field)
          : source &&
            typeof source !== "string" &&
            hasField(source, binding.field);
      if (!valid)
        throw new Error(
          `Missing pinned owner/field: ${snapshot.source_commit} ${key} ${owner}`,
        );
      verifiedBindings++;
    }
    for (const sample of binding.samples) {
      const text = textByPath.get(sample.sourcePath);
      if (
        !binding.owners.includes(sample.owner) ||
        !text ||
        (sample.sourceLine && sample.sourceLine > text.split(/\r?\n/u).length)
      )
        throw new Error(`Invalid context source: ${key}`);
    }
  }
  if (verifiedBindings !== snapshot.rawRelationCount)
    throw new Error("Inventory binding count differs");
  console.log({
    sourceCommit: snapshot.source_commit,
    fields: Object.keys(snapshot.bindings).length,
    titles: snapshot.rawTitleCount,
    verifiedBindings,
  });
  return {
    source_commit: snapshot.source_commit,
    client_version: snapshot.client_version,
    rawTitleCount: snapshot.rawTitleCount,
    rawRelationCount: snapshot.rawRelationCount,
    verifiedBindings,
    sourceFiles: files.map((f) => ({
      source_path: f.path,
      raw_sha256: f.sha256,
    })),
  };
});
const payload = {
  bindingsSha256: sha(JSON.stringify(inventory)),
  labels,
  snapshots,
};
const target = `${directory}/field-labels.v1.json`;
if (process.argv.includes("--check")) {
  const stored = JSON.parse(readFileSync(target, "utf8"));
  const actual = {
    bindingsSha256: stored.bindingsSha256,
    labels: stored.labels,
    snapshots: stored.snapshots,
  };
  if (
    stored.contentSha256 !== sha(JSON.stringify(payload)) ||
    stored.contentSha256 !== sha(JSON.stringify(actual))
  )
    throw new Error("Pinned field labels, bindings or source digest differ");
} else {
  writeFileSync(
    target,
    JSON.stringify(
      {
        source_repository: inventory.source_repository,
        imported_at: new Date().toISOString(),
        importer_version: "reviewed-attribute-fields-v1",
        schema_version: "attribute-field-labels-v1",
        contentSha256: sha(JSON.stringify(payload)),
        ...payload,
      },
      null,
      2,
    ) + "\n",
  );
}
