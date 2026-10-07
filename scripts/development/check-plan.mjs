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
// Reviewed leaf components/resources have existing tests and no navigation or
// product-service responsibility. Missing sources/tests fall back to broad rules.
const focusedUnitScopes = new Map([
  [
    "src/components/ui/dataset-badge.tsx",
    [
      "tests/unit/dataset-badge.test.tsx",
      "tests/unit/i18n.test.ts",
      "tests/unit/i18n-resources.test.ts",
    ],
  ],
  [
    "src/i18n/en.json",
    ["tests/unit/i18n.test.ts", "tests/unit/i18n-resources.test.ts"],
  ],
  [
    "src/i18n/zh-CN.json",
    ["tests/unit/i18n.test.ts", "tests/unit/i18n-resources.test.ts"],
  ],
  [
    "src/i18n/official-terms.json",
    ["tests/unit/i18n.test.ts", "tests/unit/i18n-resources.test.ts"],
  ],
  [
    "scripts/development/check-plan.mjs",
    ["tests/unit/development-check-plan.test.ts"],
  ],
  [
    "scripts/development/check-plan.d.mts",
    ["tests/unit/development-check-plan.test.ts"],
  ],
]);
const journeyPatterns = {
  heroes: "heroes:",
  abilities: "abilities:",
  tooltips: "heroes and abilities:",
  units: "units:",
  items: "items:",
  attributes: "attributes:",
  releases: "heroes releases:",
  changes: "heroes changes:",
  locale: "heroes global (?:language|locale) ",
  names: "abilities, units, items names:",
};
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
const rootsForDocs = () => [
  "AGENTS.md",
  "CONTEXT.md",
  "README.md",
  "CLAUDE.md",
  "opencode.json",
  "package.json",
];

// File-backed map computation does not read the product database. store.ts and
// app/map still read Catalog metadata and retain the normal database checks.
const mapOnly =
  /^(?:src\/(?:domain\/map\/|importers\/dota-map\/|components\/map\/|server\/map\/(?:packages|navigation)\.ts)|src\/workers\/(?:index-maps|extract-map-vpk|extract-local-map|import-public-map|import-local-map|import-map|enrich-map-economy)\.ts|tests\/unit\/map(?:[.-]))/;
const mapScope =
  /^(?:src\/(?:domain\/map\/|importers\/dota-map\/|components\/map\/|server\/map\/|app\/(?:api\/)?map)|src\/workers\/[^/]*map|tests\/unit\/map(?:[.-]))/;
const unitScope =
  /(?:^src\/(?:domain\/units\.ts|importers\/dota-vpk\/unit-(?:adapter|snapshot)\.ts|server\/repositories\/units\.ts|workers\/import-unit-assets\.ts|app\/units\/|components\/unit)|unit-(?:assets|ability-icons)|tests\/unit\/unit-)/;
const mapTests = [
  "map",
  "map-currents",
  "map-economy",
  "map-import",
  "map-native",
  "map-navigation-source",
  "map-public",
  "map-route-client",
  "map-routing",
  "map-sync",
  "map-versions",
]
  .map((name) => `tests/unit/${name}.test.ts`)
  .concat("tests/unit/map-viewer.test.tsx");
const unitTests = ["unit-adapter", "unit-source", "unit-assets"].map(
  (name) => `tests/unit/${name}.test.ts`,
);

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
  if (paths.length)
    add(
      "docs",
      "文档索引、链接、命令和客户端入口；代码删除也可能使引用失效",
      ["docs:check"],
      [
        "docs",
        ...rootsForDocs(),
        ...allRuntime,
        "public",
        "scripts/documentation",
      ],
    );
  if (paths.some((path) => path.startsWith("scripts/documentation/")))
    add(
      "docs-tests",
      "文档门禁的缺失引用、替代环和预算回归",
      ["exec", "node", "--test", "scripts/documentation/check.test.mjs"],
      ["scripts/documentation", "docs", ...rootsForDocs(), ...allRuntime],
    );
  const runtimePaths = paths.filter(
    (path) =>
      !path.startsWith("scripts/documentation/") &&
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
  const focused = runtimePaths.filter(
    (path) =>
      existsSync(path) &&
      focusedUnitScopes.get(path)?.every((test) => existsSync(test)),
  );
  const flowPaths = runtimePaths.filter((path) => !focused.includes(path));
  const wide = flowPaths.some((path) => toolchain.test(path));
  const nonMap = flowPaths.filter((path) => !mapOnly.test(path));
  const hasMap = flowPaths.some((path) => mapScope.test(path));
  const hasUnits = flowPaths.some((path) => unitScope.test(path));
  const catalogData =
    wide ||
    nonMap.some(
      (path) =>
        !unitScope.test(path) && (data.test(path) || foundation.test(path)),
    );
  const hasData =
    wide || nonMap.some((path) => data.test(path) || foundation.test(path));
  const hasUi =
    wide ||
    flowPaths.some((path) => /^src\/(?:i18n\/|proxy\.ts$)/.test(path)) ||
    nonMap.some((path) => !unitScope.test(path) && ui.test(path));
  const hasEngine = nonMap.some((path) => engine.test(path));
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
  const unknownSource = nonMap.some(
    (path) =>
      path.startsWith("src/") &&
      !ui.test(path) &&
      !unitScope.test(path) &&
      !/^src\/importers\/dota-vpk\//.test(path),
  );
  const removedUnit = paths.some(
    (path) =>
      /^tests\/unit\/.*\.test\.[jt]sx?$/.test(path) && !existsSync(path),
  );
  if (wide || unknownSource || removedUnit)
    add(
      "unit",
      "工具链、共享依赖、未知影响范围或删除用例，检查全部既有单元测试",
      ["test"],
      [...allRuntime, "tests/unit", "vitest.config.ts"],
    );
  else {
    const unitFiles = new Set([
      ...explicitUnit,
      ...focused.flatMap((path) => focusedUnitScopes.get(path)),
    ]);
    if (hasUi || hasMap || hasUnits) {
      unitFiles.add("tests/unit/i18n.test.ts");
      unitFiles.add("tests/unit/i18n-resources.test.ts");
    }
    if (hasMap || flowPaths.some((path) => sharedUi.test(path)))
      mapTests.forEach((path) => unitFiles.add(path));
    if (hasUnits) unitTests.forEach((path) => unitFiles.add(path));
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
  const shared = flowPaths.some((path) => sharedUi.test(path));
  const localeRuntime = flowPaths.some((path) =>
    /^src\/(?:i18n\/|proxy\.ts$)/.test(path),
  );
  if (catalogData || (hasUi && (wide || shared || localeRuntime))) {
    journeys.add("heroes");
    journeys.add("abilities");
  } else if (hasUi) {
    if (flowPaths.some((path) => /abilit/.test(path)))
      journeys.add("abilities");
    if (flowPaths.some((path) => /hero/.test(path))) journeys.add("heroes");
    if (
      !journeys.size &&
      !flowPaths.some((path) => /items|attributes|changes|release/.test(path))
    ) {
      journeys.add("heroes");
      journeys.add("abilities");
    }
  }
  if (journeys.has("heroes") || journeys.has("abilities"))
    journeys.add("tooltips");
  if (wide || shared || localeRuntime || hasUnits) journeys.add("units");
  if (
    wide ||
    shared ||
    localeRuntime ||
    flowPaths.some((path) => /(?:items|item-)/.test(path))
  )
    journeys.add("items");
  if (
    wide ||
    shared ||
    localeRuntime ||
    flowPaths.some((path) =>
      /attribute|item-adapter|unit-adapter|ability-tooltip|unit-stats/.test(
        path,
      ),
    )
  )
    journeys.add("attributes");
  if (
    wide ||
    shared ||
    localeRuntime ||
    catalogData ||
    flowPaths.some((path) => /releases?|version-link/.test(path))
  )
    journeys.add("releases");
  if (
    wide ||
    shared ||
    localeRuntime ||
    catalogData ||
    flowPaths.some((path) =>
      /changes|entity-version-diff|patch-notes/.test(path),
    )
  )
    journeys.add("changes");
  if (wide || shared || localeRuntime) journeys.add("locale");
  if (
    wide ||
    catalogData ||
    flowPaths.some((path) => /entity-names/.test(path))
  )
    journeys.add("names");
  // Editing a journey must execute the test even if its title is new or renamed.
  const changedJourneys = paths.some((path) =>
    path.startsWith("tests/journeys/"),
  );
  if (journeys.size || changedJourneys)
    add(
      "journeys",
      changedJourneys
        ? "浏览流程测试变更，执行全部旅程以覆盖新增、改名与删除"
        : `受影响的使用流程：${[...journeys].join("、")}；失败用例单独重试一次`,
      [
        "exec",
        "tsx",
        "src/workers/run-shared-tests.ts",
        "journeys",
        // Playwright retries only the failed case in a fresh worker/context.
        // Passed cases remain valid within this run; source/data drift is still
        // rejected by run-shared-tests and run-check after the entire run.
        "--retries=1",
        ...(changedJourneys
          ? []
          : [
              "--grep",
              `(?:^|\\s)(?:${[...journeys].map((name) => journeyPatterns[name]).join("|")})`,
            ]),
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
        "--retries=1",
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
