import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function changedFiles(base) {
  const git = (args) =>
    execFileSync("git", args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 })
      .split("\0")
      .filter(Boolean);
  // --no-renames includes both old and new paths, so removed dependencies invalidate results.
  return [
    ...new Set([
      ...git(["diff", "--name-only", "--no-renames", "-z", base || "HEAD"]),
      ...git(["ls-files", "--others", "--exclude-standard", "-z"]),
    ]),
  ].sort();
}

const toolchain =
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|.*config\.(?:ts|mjs|json)|\.github\/workflows\/|scripts\/development\/|src\/testing\/|src\/development\/|src\/workers\/(?:dev|run-test|run-check|prepare-development|typecheck|run-shared|bench|release))/;
const foundation =
  /^(src\/(?:domain|lib|config)\/|tests\/(?:fixtures|helpers)\/)/;
const data =
  /^(src\/(?:importers|server|workers)\/|drizzle\/|docker\/|docker-compose)/;
const ui = /^src\/(?:app|components)\//;
const sharedUi =
  /(?:layout\.tsx|globals\.css|app-shell|infinite-list|components\/ui\/)/;
const engine = /^src\/(?:importers|domain|lib)\/|^tests\/fixtures\/vpk\//;
const environment =
  /^src\/(?:server\/environment|config\/|testing\/)|^docker|^drizzle\//;
const settings = [
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "tsconfig.check.json",
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.production",
  ".env.production.local",
  "scripts/development",
  "src/development",
  "src/workers/run-check.ts",
];
const allRuntime = [
  "src",
  "tests/helpers",
  "tests/fixtures",
  "drizzle",
  "docker",
  "docker-compose.data-stack.yml",
  "docker-compose.test-run.yml",
  "next.config.ts",
  ...settings,
];
const parserTests = [
  "tests/unit/hero-adapter.test.ts",
  "tests/unit/ability-adapter.test.ts",
  "tests/unit/keyvalues-parser.test.ts",
];

export function createPlan(inputPaths) {
  const paths = [
    ...new Set(inputPaths.map((path) => path.replaceAll("\\", "/"))),
  ].sort();
  if (
    paths.some(
      (path) =>
        path.startsWith("/") ||
        path.split("/").includes("..") ||
        path.startsWith("-"),
    )
  )
    throw new Error("Check paths must be workspace-relative paths.");
  const tasks = [];
  function add(id, reason, args, inputs, kind = "static") {
    tasks.push({
      id,
      reason,
      command: "pnpm",
      args,
      inputs: [...new Set([...inputs, ...settings])],
      kind,
    });
  }
  const existing = paths.filter((path) => existsSync(path));
  const formatting = existing.filter(
    (path) =>
      /\.(?:md|json|mjs|ts|tsx|css|ya?ml)$/.test(path) &&
      !path.startsWith("docs/reviews/"),
  );
  if (formatting.length)
    add(
      "format",
      "改动文件的格式",
      ["exec", "prettier", "--check", ...formatting],
      [...formatting, ".prettierignore", ".prettierrc.json"],
    );
  const lintFiles = existing.filter((path) => /\.(?:ts|tsx|mjs)$/.test(path));
  if (lintFiles.length)
    add(
      "lint",
      "改动的代码和脚本",
      ["exec", "eslint", ...lintFiles],
      [...lintFiles, "eslint.config.mjs"],
    );
  const runtimePaths = paths.filter((path) =>
    /^(src\/|tests\/|scripts\/|drizzle\/|docker|.*config\.|package\.json|pnpm-(?:lock|workspace)\.yaml|\.github\/)/.test(
      path,
    ),
  );
  if (!runtimePaths.length)
    return {
      schemaVersion: 1,
      paths,
      tasks,
      browser: false,
      database: false,
      summary: "文档或说明变更，无需产品数据库和浏览器",
    };
  const wide = runtimePaths.some((path) => toolchain.test(path));
  const hasData =
    wide ||
    runtimePaths.some((path) => data.test(path) || foundation.test(path));
  const hasUi = wide || runtimePaths.some((path) => ui.test(path));
  const hasEngine = runtimePaths.some((path) => engine.test(path));
  const dbContract = runtimePaths.some((path) => environment.test(path));
  if (
    runtimePaths.some(
      (path) => /\.[cm]?[jt]sx?$/.test(path) || toolchain.test(path),
    )
  )
    add(
      "types",
      "相关 TypeScript 或工具链变化；复用编译器的项目增量结果",
      ["typecheck"],
      [
        ...allRuntime,
        "tests/unit",
        "tests/journeys",
        "playwright.config.ts",
        "playwright.shared.config.ts",
        "vitest.config.ts",
      ],
    );
  const explicitUnit = existing.filter((path) =>
    /^tests\/unit\/.*\.test\.[jt]sx?$/.test(path),
  );
  if (wide)
    add(
      "unit",
      "工具链或检查入口变化会影响既有单元测试",
      ["test"],
      [...allRuntime, "tests/unit", "vitest.config.ts"],
    );
  else {
    const unitFiles = new Set(explicitUnit);
    if (hasEngine) parserTests.forEach((path) => unitFiles.add(path));
    if (
      paths.some((path) => /filters|catalog-cursor|catalog-stream/.test(path))
    )
      ["hero-filters", "ability-filters", "catalog-cursor"].forEach((name) =>
        unitFiles.add(`tests/unit/${name}.test.ts`),
      );
    if (paths.some((path) => /infinite/.test(path)))
      ["infinite-list", "infinite-catalog", "detail-infinite-lists"].forEach(
        (name) => unitFiles.add(`tests/unit/${name}.test.tsx`),
      );
    if (paths.some((path) => /assets|asset-route|valve-asset/.test(path)))
      ["catalog-assets", "asset-route"].forEach((name) =>
        unitFiles.add(`tests/unit/${name}.test.ts`),
      );
    if (dbContract)
      [
        "environment-contract",
        "environment-isolation",
        "data-stack-lifecycle",
      ].forEach((name) => unitFiles.add(`tests/unit/${name}.test.ts`));
    if (unitFiles.size)
      add(
        "unit",
        "复用本次功能已有的针对性测试",
        ["test", ...unitFiles],
        [...allRuntime, ...unitFiles, "vitest.config.ts"],
      );
  }
  const journeys = new Set();
  if (
    hasData ||
    (hasUi && (wide || paths.some((path) => sharedUi.test(path))))
  ) {
    journeys.add("heroes");
    journeys.add("abilities");
  } else if (hasUi) {
    if (paths.some((path) => /abilit/.test(path))) journeys.add("abilities");
    if (paths.some((path) => /hero/.test(path))) journeys.add("heroes");
    if (!journeys.size) {
      journeys.add("heroes");
      journeys.add("abilities");
    }
  }
  if (paths.some((path) => /^tests\/journeys\//.test(path))) {
    journeys.add("heroes");
    journeys.add("abilities");
  }
  if (wide || paths.some((path) => /(?:units|unit-)/.test(path)))
    journeys.add("units");
  if (journeys.size)
    add(
      "journeys",
      "受影响的目录、筛选、详情与查询流程",
      [
        "exec",
        "tsx",
        "src/workers/run-shared-tests.ts",
        "journeys",
        "--grep",
        [...journeys].join("|"),
      ],
      [...allRuntime, "tests/journeys", "playwright.shared.config.ts"],
      "browser",
    );
  const integrationChanged = paths.some((path) =>
    path.startsWith("tests/integration/"),
  );
  const e2eChanged = paths.some((path) => path.startsWith("tests/e2e/"));
  if (e2eChanged)
    add(
      "e2e",
      "直接执行改动的既有浏览器测试；测试被删除时验证剩余流程",
      [
        "test:e2e",
        ...existing.filter((path) =>
          /^tests\/e2e\/.*\.spec\.[jt]sx?$/.test(path),
        ),
      ],
      [
        ...allRuntime,
        "tests/e2e",
        "playwright.config.ts",
        "playwright.shared.config.ts",
      ],
      "browser",
    );
  if ((hasData || integrationChanged) && !dbContract)
    add(
      "database",
      "数据处理或查询变化：保存、原子更新与固定版本查询",
      integrationChanged
        ? [
            "test:integration",
            ...existing.filter((path) =>
              /^tests\/integration\/.*\.test\.[jt]sx?$/.test(path),
            ),
          ]
        : [
            "test:integration",
            "--testNamePattern",
            "enforces canonical|partially materialized|bidirectional catalog|applies the checked",
          ],
      [...allRuntime, "tests/integration", "vitest.integration.config.ts"],
      "database",
    );
  if (dbContract)
    add(
      "database-contract",
      "数据库身份、权限、迁移或环境规则变化，需要完整合同检查",
      ["test:integration:isolated"],
      [...allRuntime, "tests/integration", "vitest.integration.config.ts"],
      "database",
    );
  if (hasEngine)
    add(
      "benchmark",
      "解析或计算相关实现变化，记录当前小样例基线",
      ["bench", "--iterations", "5"],
      [...allRuntime, "tests/fixtures/vpk"],
      "benchmark",
    );
  if (wide)
    add(
      "build",
      "运行代码或构建依赖变化；检查当前单一 Web 发布单元",
      ["release", "--build-only"],
      [...allRuntime, "public"],
      "build",
    );
  return {
    schemaVersion: 1,
    paths,
    tasks,
    browser: tasks.some((task) => task.kind === "browser"),
    database: tasks.some((task) =>
      ["browser", "database", "build"].includes(task.kind),
    ),
    summary: `${tasks.length} 项检查；每项列出触发原因，复用条件匹配的通过结果`,
  };
}

export function parseArguments(args) {
  const result = {
    base: undefined,
    files: undefined,
    plan: false,
    json: false,
    force: false,
    watch: false,
  };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--base") {
      result.base = args[++index];
      if (!result.base) throw new Error("--base requires a Git revision.");
    } else if (arg === "--files") {
      result.files = [];
      while (args[index + 1] && !args[index + 1].startsWith("--"))
        result.files.push(args[++index]);
      if (!result.files.length)
        throw new Error("--files requires at least one path.");
    } else if (["--plan", "--json", "--force", "--watch"].includes(arg))
      result[arg.slice(2)] = true;
    else throw new Error(`Unknown check option: ${arg}`);
  }
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const options = parseArguments(process.argv.slice(2));
  console.log(
    JSON.stringify(
      createPlan(options.files ?? changedFiles(options.base)),
      null,
      2,
    ),
  );
}
