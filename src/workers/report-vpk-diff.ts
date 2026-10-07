import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { getCatalogSourceConfig } from "@/importers/catalog-source-lock";
import {
  CATALOG_STATIC_SOURCE_PATHS,
  HERO_ABILITY_SOURCE_PATTERN,
  VPK_SOURCE_REPOSITORY,
} from "@/importers/dota-vpk/constants";
import { readHeroSource } from "@/importers/dota-vpk/hero-source";
import type { CheckedSourceFile } from "@/importers/git-checkout";
import { keyValuesData } from "@/importers/keyvalues/data";
import {
  objectEntries,
  parseKeyValues,
  uniqueObject,
  type KeyValuesObject,
} from "@/importers/keyvalues/parser";
import {
  compareEntityVersions,
  type EntityKind,
  type EntityVersionSnapshot,
  type EntityVersionState,
} from "@/domain/entity-version-diff";
import { sha256 } from "@/lib/hash";
import { requiredArgument } from "./cli-args";

const exec = promisify(execFile);
const extraPaths = [
  "scripts/npc/items.txt",
  "scripts/npc/npc_units.txt",
  "scripts/npc/neutral_items.txt",
  "scripts/change_log.txt",
];
async function readSnapshot(mirror: string, commit: string) {
  if (!/^[a-f0-9]{40}$/u.test(commit))
    throw new Error("A full source commit is required.");
  const git = async (...args: string[]) =>
    (
      await exec("git", ["--git-dir", mirror, ...args], {
        encoding: "utf8",
        maxBuffer: 24 * 1024 * 1024,
      })
    ).stdout;
  const dynamic = (
    await git(
      "ls-tree",
      "-r",
      "--name-only",
      commit,
      "--",
      "scripts/npc/heroes",
    )
  )
    .split("\n")
    .filter((path) => HERO_ABILITY_SOURCE_PATTERN.test(path));
  const paths = [...CATALOG_STATIC_SOURCE_PATHS, ...dynamic, ...extraPaths];
  const files: CheckedSourceFile[] = await Promise.all(
    paths.map(async (path) => {
      const text = await git("show", `${commit}:${path}`);
      const bytes = Buffer.from(text);
      return {
        path,
        text,
        bytes,
        sha256: sha256(bytes),
        sizeBytes: bytes.length,
        encoding: "utf-8",
      };
    }),
  );
  const clientVersion = /^ClientVersion=(.+)$/mu
    .exec(files.find((file) => file.path === "steam.inf")!.text)![1]
    .trim();
  const entities: Partial<Record<EntityKind, EntityVersionState[]>> = {};
  const add = (
    kind: EntityKind,
    key: string,
    object: KeyValuesObject,
    file: CheckedSourceFile,
    line: number,
  ) => {
    (entities[kind] ??= []).push({
      key,
      fields: keyValuesData(object),
      sources: [
        {
          repository: VPK_SOURCE_REPOSITORY,
          commit,
          path: file.path,
          line,
          sha256: file.sha256,
          clientVersion,
        },
      ],
    });
  };
  const heroes = readHeroSource(files);
  for (const entry of heroes.root.entries) {
    if (typeof entry.value !== "object")
      throw new Error(`Invalid hero ${entry.key}`);
    add(
      "hero",
      entry.key,
      {
        entries: entry.value.entries.filter(
          (e) => e.key !== "AbilityDefinitions",
        ),
      },
      heroes.origins.get(entry.key)!,
      entry.line,
    );
  }
  for (const file of files.filter(
    (f) =>
      f.path === "scripts/npc/npc_abilities.txt" ||
      HERO_ABILITY_SOURCE_PATTERN.test(f.path) ||
      f.path === "scripts/npc/items.txt",
  )) {
    const document = parseKeyValues(file.text);
    const roots = objectEntries(document, "DOTAAbilities");
    const blocks: KeyValuesObject[] = roots.map((entry) => {
      if (typeof entry.value === "string")
        throw new Error(`Invalid DOTAAbilities: ${file.path}`);
      return entry.value;
    });
    if (!roots.length) {
      for (const hero of uniqueObject(document, "DOTAHeroes").entries) {
        if (typeof hero.value === "string") continue;
        for (const block of objectEntries(hero.value, "AbilityDefinitions")) {
          if (typeof block.value === "string")
            throw new Error(`Invalid AbilityDefinitions: ${file.path}`);
          blocks.push(block.value);
        }
      }
    }
    for (const block of blocks)
      for (const entry of block.entries) {
        if (typeof entry.value !== "object") continue;
        // Duplicate ability definitions follow Valve's final-occurrence rule; retain evidence.
        const previous =
          entities.ability?.findIndex((entity) => entity.key === entry.key) ??
          -1;
        if (previous >= 0) entities.ability!.splice(previous, 1);
        add("ability", entry.key, entry.value, file, entry.line);
      }
  }
  const unitFile = files.find((f) => f.path === "scripts/npc/npc_units.txt")!;
  for (const entry of uniqueObject(parseKeyValues(unitFile.text), "DOTAUnits")
    .entries) {
    if (typeof entry.value === "object")
      add("unit", entry.key, entry.value, unitFile, entry.line);
  }
  const neutralFile = files.find(
    (f) => f.path === "scripts/npc/neutral_items.txt",
  )!;
  add(
    "mechanism",
    "neutral-item-pools",
    uniqueObject(parseKeyValues(neutralFile.text), "neutral_items"),
    neutralFile,
    1,
  );
  const snapshot: EntityVersionSnapshot = {
    version: commit,
    implementation: { projection: "raw-vpk-kv-v1" },
    groups: Object.fromEntries(
      Object.entries(entities).map(([kind, records]) => [
        kind,
        {
          status: "complete",
          reason: null,
          identityScheme: "vpk-internal-name-v1",
          entities: records,
        },
      ]),
    ),
  };
  return {
    snapshot,
    clientVersion,
    files: files.map(({ path, sha256, sizeBytes }) => ({
      path,
      sha256,
      sizeBytes,
    })),
  };
}
async function main() {
  const from = requiredArgument("from");
  const to = requiredArgument("to");
  const output = requiredArgument("output");
  const config = await getCatalogSourceConfig();
  const [before, after] = await Promise.all([
    readSnapshot(config.mirrorPath, from),
    readSnapshot(config.mirrorPath, to),
  ]);
  const diff = compareEntityVersions(before.snapshot, after.snapshot);
  const kind = (entityType: string, key: string) =>
    key.startsWith("item_") ? "item" : entityType;
  const summary = Object.fromEntries(
    ["hero", "ability", "item", "unit", "mechanism"].map((type) => {
      const changes = diff.changes.filter(
        (change) => kind(change.entityType, change.entityKey) === type,
      );
      return [
        type,
        {
          entities: new Set(changes.map((change) => change.entityKey)).size,
          fields: changes.length,
        },
      ];
    }),
  );
  const fileMap = new Map(before.files.map((file) => [file.path, file]));
  const fileDiff: Array<{
    path: string;
    before: (typeof before.files)[number] | null;
    after: (typeof after.files)[number] | null;
  }> = after.files
    .filter((file) => fileMap.get(file.path)?.sha256 !== file.sha256)
    .map((file) => ({
      path: file.path,
      before: fileMap.get(file.path) ?? null,
      after: file,
    }));
  for (const file of before.files)
    if (!after.files.some((f) => f.path === file.path))
      fileDiff.push({
        path: file.path,
        before: file,
        after: null,
      });
  const report = {
    schemaVersion: "vpk-diff-report-v1",
    generatedAt: new Date().toISOString(),
    sourceRepository: VPK_SOURCE_REPOSITORY,
    from: {
      commit: from,
      clientVersion: before.clientVersion,
      files: before.files,
    },
    to: { commit: to, clientVersion: after.clientVersion, files: after.files },
    coverage:
      "固定来源的KV定义；不包含引擎二进制行为。原始文件行号、注释与唯一键顺序不作为游戏值；英雄文件搬迁与技能嵌套结构已归一化。",
    summary,
    fileDiff,
    diff,
  };
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        output,
        summary,
        fileChanges: fileDiff.length,
        fields: diff.changes.length,
      },
      null,
      2,
    ),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
