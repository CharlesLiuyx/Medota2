import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const core = [
  "AGENTS.md",
  "CONTEXT.md",
  "docs/current.md",
  "docs/development-environments.md",
];
const roots = [...core, "README.md", "CLAUDE.md"];
const read = (root, file) => readFileSync(resolve(root, file), "utf8");
function files(root, directory) {
  if (!existsSync(resolve(root, directory))) return [];
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const path = `${directory}/${entry.name}`;
      return entry.isDirectory()
        ? files(root, path)
        : /\.(md|html|json)$/.test(path)
          ? [path]
          : [];
    },
  );
}
function withoutFences(text) {
  return text.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm, "");
}
function anchors(text) {
  const result = new Set();
  const counts = new Map();
  for (const match of withoutFences(text).matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const slug = match[1]
      .toLowerCase()
      .replace(/<[^>]+>/g, "")
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "")
      .replace(/\s/g, "-");
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    result.add(count ? `${slug}-${count}` : slug);
  }
  for (const match of text.matchAll(/\b(?:id|name)=["']([^"']+)["']/g))
    result.add(match[1]);
  return result;
}

export function checkDocumentation(root = process.cwd()) {
  const errors = [];
  const warnings = [];
  const fail = (file, message) => errors.push(`${file}: ${message}`);
  const inventory = files(root, "docs");
  for (const file of [
    ...roots,
    "docs/README.md",
    "opencode.json",
    "package.json",
  ])
    if (!existsSync(resolve(root, file))) fail(file, "missing required entry");
  if (errors.length)
    return { errors, warnings, documents: inventory.length, coreBytes: 0 };
  const registry = new Map();
  for (const match of read(root, "docs/README.md").matchAll(
    /^\|\s*\[[^\]]+\]\(([^)]+)\)\s*\|\s*(active|reference|historical)\s*\|/gm,
  )) {
    const file = relative(root, resolve(root, "docs", match[1])).replaceAll(
      "\\",
      "/",
    );
    if (registry.has(file)) fail(file, "duplicate index entry");
    registry.set(file, match[2]);
    if (!inventory.includes(file))
      fail(file, "indexed document does not exist");
  }
  for (const file of inventory)
    if (file !== "docs/README.md" && !registry.has(file))
      fail(file, "document missing from docs/README.md status table");

  const markdown = [
    ...new Set([...roots, ...inventory.filter((file) => file.endsWith(".md"))]),
  ];
  const texts = new Map(markdown.map((file) => [file, read(root, file)]));
  const anchorCache = new Map();
  function target(file, url) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return;
    let decoded;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      fail(file, `invalid URL: ${url}`);
      return;
    }
    const [path, fragment] = decoded.split("#");
    const absolute = path
      ? resolve(root, dirname(file), path)
      : resolve(root, file);
    const name = relative(root, absolute).replaceAll("\\", "/");
    if (name.startsWith("../") || !existsSync(absolute)) {
      fail(file, `missing local target: ${url}`);
      return;
    }
    if (fragment && name.endsWith(".md")) {
      if (!anchorCache.has(name))
        anchorCache.set(name, anchors(texts.get(name) ?? read(root, name)));
      if (!anchorCache.get(name).has(fragment))
        fail(file, `missing heading: ${url}`);
    }
    return name;
  }
  const successors = new Map();
  const scripts = JSON.parse(read(root, "package.json")).scripts ?? {};
  const builtin = new Set([
    "install",
    "exec",
    "dlx",
    "add",
    "remove",
    "update",
    "why",
    "list",
    "store",
    "config",
    "--version",
  ]);
  for (const [file, text] of texts) {
    const prose = withoutFences(text);
    for (const match of prose.matchAll(
      /\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
    ))
      target(file, match[1] ?? match[2]);
    for (const match of prose.matchAll(/^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?/gm))
      target(file, match[1]);
    const next = [...prose.matchAll(/<!--\s*superseded-by:\s*(\S+)\s*-->/g)]
      .map((match) => target(file, match[1]))
      .filter(Boolean);
    if (next.length) successors.set(file, next);
    if (
      registry.get(file) === "historical" ||
      registry.get(file) === "reference"
    )
      continue;
    // Commands are parsed, never executed; parameters remain the owning CLI's contract.
    for (const match of text.matchAll(
      /\bpnpm\s+(?:run\s+)?([a-zA-Z][\w:-]*)/g,
    )) {
      if (!builtin.has(match[1]) && !Object.hasOwn(scripts, match[1]))
        fail(file, `unknown pnpm command: ${match[1]}`);
    }
    for (const match of text.matchAll(
      /\bpnpm\s+exec\s+tsx\s+((?:src|scripts)\/[\w./-]+)/g,
    ))
      target(file, relative(dirname(file), match[1]).replaceAll("\\", "/"));
  }
  function visit(file, stack = new Set()) {
    if (stack.has(file)) {
      fail(file, "cyclic superseded-by relation");
      return;
    }
    for (const next of successors.get(file) ?? [])
      visit(next, new Set([...stack, file]));
  }
  for (const file of successors.keys()) visit(file);
  const claude = [...read(root, "CLAUDE.md").matchAll(/^@([^\s]+)$/gm)].map(
    (match) => match[1],
  );
  for (const file of claude) target("CLAUDE.md", file);
  for (const file of core)
    if (!claude.includes(file))
      fail("CLAUDE.md", `missing context import: ${file}`);
  try {
    const instructions =
      JSON.parse(read(root, "opencode.json")).instructions ?? [];
    for (const file of instructions) target("opencode.json", file);
    // OpenCode reads root AGENTS.md natively; supplemental context is explicit.
    for (const file of core.slice(1))
      if (!instructions.includes(file))
        fail("opencode.json", `missing context import: ${file}`);
  } catch {
    fail("opencode.json", "invalid client configuration");
  }
  const coreBytes = core.reduce(
    (sum, file) => sum + statSync(resolve(root, file)).size,
    0,
  );
  if (coreBytes > 20 * 1024)
    warnings.push(
      `Core context is ${coreBytes} bytes (target <= 20480); consolidate ownership, do not truncate.`,
    );
  return {
    errors: [...new Set(errors)],
    warnings,
    documents: inventory.length,
    coreBytes,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = checkDocumentation();
  result.errors.forEach((error) => console.error(`ERROR ${error}`));
  result.warnings.forEach((warning) => console.warn(`WARN ${warning}`));
  console.log(
    `Documentation: ${result.documents} indexed files; core ${result.coreBytes} bytes; ${result.errors.length} errors.`,
  );
  if (result.errors.length) process.exitCode = 1;
}
