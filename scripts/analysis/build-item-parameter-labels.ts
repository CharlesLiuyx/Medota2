import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { adaptItems } from "../../src/importers/dota-vpk/item-adapter";
import { unitTokens } from "../../src/importers/dota-vpk/unit-adapter";

// This is an explicit reviewed vocabulary, not a runtime key-name translator.
// Only the owner/field bindings checked into supplement.v1.json are consumed.
const root = process.argv[2];
if (!root) throw new Error("Provide a read-only source Git repository");
const directory = "src/data/item-parameters";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function labels(file: string) {
  const rows = new Map<string, { zh: string; en: string; unit: string }>();
  for (const line of readFileSync(`${directory}/${file}`, "utf8")
    .split("\n")
    .filter(Boolean)) {
    const [key, zh, en, rawUnit, extra] = line.split("\t");
    const unit = rawUnit === "-" ? "" : rawUnit;
    if (
      !key ||
      !zh ||
      !en ||
      extra !== undefined ||
      !["", "%", "s", "min"].includes(unit) ||
      rows.has(key)
    )
      throw new Error(`Invalid or duplicate reviewed label: ${line}`);
    rows.set(key, { zh, en, unit });
  }
  return rows;
}
const common = labels("reviewed-labels.tsv");
const overrides = labels("owner-overrides.tsv");
const snapshots = [];
const parameters: Record<string, { zh: string; en: string; unit: string }> = {};
const paths = [
  "scripts/npc/items.txt",
  "resource/localization/abilities_schinese.txt",
  "resource/localization/abilities_english.txt",
  "steam.inf",
];
for (const commit of [
  "991daaf6fc24b08445209d9ce8767e145bab107e",
  "f4c45719314754567cb4ef4fe343bbc790a311f4",
]) {
  const files = paths.map((path) =>
    execFileSync("git", ["-C", root, "show", `${commit}:${path}`], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  const zh = unitTokens(files[1]),
    en = unitTokens(files[2]);
  // No source commit means no supplement: the audit always measures the source baseline.
  const items = adaptItems(files[0], zh, en).items;
  const evidence: Record<
    string,
    {
      definitionLine: number;
      kind: string;
      token?: string;
      textLine?: number;
      commentedLabel?: string;
    }
  > = {};
  let missing = 0;
  for (const item of items)
    for (const stat of item.stats) {
      if (stat.zh !== "未命名参数" && stat.en !== "Unnamed parameter") continue;
      missing++;
      const id = `${item.internalName}.${stat.key}`;
      const label = overrides.get(id) ?? common.get(stat.key);
      if (!label) throw new Error(`Unreviewed parameter: ${id}`);
      if (
        parameters[id] &&
        JSON.stringify(parameters[id]) !== JSON.stringify(label)
      )
        throw new Error(`Conflicting label: ${id}`);
      parameters[id] = label;
      const prefix = `dota_tooltip_ability_${item.internalName}_`;
      const description = Object.entries(en).find(
        ([token, text]) =>
          token.startsWith(prefix) &&
          /_description$|_note\d+$/.test(token) &&
          text.toLowerCase().includes(`%${stat.key}%`),
      );
      const commentedLine = files[2]
        .split(/\r?\n/)
        .findIndex(
          (line) =>
            /^\s*\/\//.test(line) &&
            line.toLowerCase().includes(`"${prefix}${stat.key}"`),
        );
      const token =
        description?.[0] ??
        (commentedLine >= 0 ? `${prefix}${stat.key}` : undefined);
      const textLine = description
        ? files[2]
            .split(/\r?\n/)
            .findIndex(
              (line) =>
                !/^\s*\/\//.test(line) &&
                line.toLowerCase().includes(`"${description[0]}"`),
            ) + 1
        : commentedLine + 1;
      if (!stat.sourceLine) throw new Error(`Missing source line: ${id}`);
      evidence[id] = {
        definitionLine: stat.sourceLine,
        kind: description
          ? "description"
          : commentedLine >= 0
            ? "commented-label"
            : "definition",
        ...(token ? { token, textLine } : {}),
        ...(commentedLine >= 0
          ? { commentedLabel: files[2].split(/\r?\n/)[commentedLine].trim() }
          : {}),
      };
    }
  const clientVersion = files[3].match(/^ClientVersion=(.+)$/m)?.[1].trim();
  if (!clientVersion) throw new Error("Missing ClientVersion");
  snapshots.push({
    source_commit: commit,
    client_version: clientVersion,
    itemCount: items.length,
    missingBefore: missing,
    files: paths.map((path, i) => ({
      source_path: path,
      raw_sha256: sha(files[i]),
    })),
    evidence,
  });
}
const payload = { parameters, snapshots };
if (process.argv.includes("--check")) {
  const stored = JSON.parse(
    readFileSync(`${directory}/supplement.v1.json`, "utf8"),
  );
  if (sha(JSON.stringify(payload)) !== stored.contentSha256)
    throw new Error(
      "Reviewed labels or pinned evidence differ from the saved supplement",
    );
  for (const snapshot of snapshots) {
    const read = (path: string) =>
      execFileSync(
        "git",
        ["-C", root, "show", `${snapshot.source_commit}:${path}`],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      );
    const items = adaptItems(
      read(paths[0]),
      unitTokens(read(paths[1])),
      unitTokens(read(paths[2])),
      snapshot.source_commit,
    ).items;
    const missing = items.flatMap((item) =>
      item.stats.filter(
        (stat) => stat.zh === "未命名参数" || stat.en === "Unnamed parameter",
      ),
    );
    if (missing.length)
      throw new Error(
        `Still missing ${missing.length} labels in ${snapshot.source_commit}`,
      );
    console.log({
      commit: snapshot.source_commit,
      items: items.length,
      missingBefore: snapshot.missingBefore,
      missingAfter: missing.length,
    });
  }
} else
  writeFileSync(
    `${directory}/supplement.v1.json`,
    JSON.stringify(
      {
        id: "item-parameter-labels-v1",
        schema_version: "item-parameter-labels-v1",
        importer_version: "reviewed-item-parameters-v1",
        imported_at: new Date().toISOString(),
        source_repository:
          "https://github.com/spirit-bear-productions/dota_vpk_updates",
        note: "Reviewed project labels from same-commit descriptions, commented labels and explicit field definitions. Definition labels do not certify engine semantics; commented text can be stale. Values are never copied from comments. Only listed owner/field/commit bindings apply.",
        contentSha256: sha(JSON.stringify(payload)),
        ...payload,
      },
      null,
      2,
    ) + "\n",
  );
console.log(
  snapshots.map((s) => ({
    commit: s.source_commit,
    items: s.itemCount,
    missingBefore: s.missingBefore,
  })),
  { bindings: Object.keys(parameters).length },
);
