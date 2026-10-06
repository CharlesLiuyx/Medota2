import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checkDocumentation } from "./check.mjs";

test("documentation gate detects drift without executing commands or reading HTML", (t) => {
  const root = mkdtempSync(join(tmpdir(), "medota2-docs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file, value) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), value);
  };
  const core = [
    "AGENTS.md",
    "CONTEXT.md",
    "docs/current.md",
    "docs/development-environments.md",
  ];
  core.forEach((file) => put(file, "# 当前规则\n"));
  put("README.md", "[current](docs/current.md#当前规则)\n`pnpm check`\n");
  put("CLAUDE.md", core.map((file) => `@${file}`).join("\n"));
  put("opencode.json", JSON.stringify({ instructions: core.slice(1) }));
  put(
    "package.json",
    JSON.stringify({ scripts: { check: "never execute this" } }),
  );
  const index =
    "| [current](current.md) | active | state |\n| [env](development-environments.md) | active | env |\n| [old](old.md) | historical | old |\n| [html](old.html) | historical | raw |\n";
  put("docs/README.md", index);
  put("docs/old.md", "`pnpm retired-script`\n");
  put(
    "docs/old.html",
    "<html>pnpm retired-script [ignored](missing.md)</html>",
  );
  assert.deepEqual(checkDocumentation(root).errors, []);
  put("docs/new.md", "# New\n");
  put(
    "README.md",
    "[bad](docs/current.md#missing)\n[removed](src/removed.ts)\n`pnpm missing-script`\n",
  );
  put("CLAUDE.md", "@AGENTS.md\n@missing.md\n");
  put("docs/current.md", "<!-- superseded-by: old.md -->\n");
  put("docs/old.md", "<!-- superseded-by: current.md -->\n");
  const errors = checkDocumentation(root).errors.join("\n");
  for (const expected of [
    "missing from",
    "missing heading",
    "src/removed.ts",
    "unknown pnpm command",
    "missing context import",
    "missing.md",
    "cyclic superseded-by",
  ])
    assert.ok(errors.includes(expected), expected);
  put("docs/README.md", `${index}| [new](new.md) | active | new |\n`);
  put("docs/new.md", "# New\n" + "x".repeat(21 * 1024));
  // Large optional documents do not increase the base context budget.
  assert.equal(checkDocumentation(root).warnings.length, 0);
  put("CONTEXT.md", readFileSync(join(root, "docs/new.md"), "utf8"));
  assert.equal(checkDocumentation(root).warnings.length, 1);
});

test("repository documentation is indexed and reachable", () => {
  assert.deepEqual(checkDocumentation().errors, []);
});
