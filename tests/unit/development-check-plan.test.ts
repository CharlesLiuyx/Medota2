import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPlan,
  warmRoutesForScopes,
} from "../../scripts/development/check-plan.mjs";

const hiddenFiles = vi.hoisted(() => new Set<string>());
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: (path: string) =>
      !hiddenFiles.has(path) && actual.existsSync(path),
  };
});
afterEach(() => hiddenFiles.clear());

function selectedJourneys(paths: string[]) {
  const task = createPlan(paths).tasks.find((task) => task.id === "journeys");
  if (!task) return () => false;
  const index = task.args.indexOf("--grep");
  const pattern = index < 0 ? null : new RegExp(task.args[index + 1]);
  return (title: string) =>
    !pattern ||
    pattern.test(`desktop-chromium tests/journeys/example.spec.ts ${title}`);
}

describe("development check scope", () => {
  it("checks retry behavior and the changes journey for availability UI", () => {
    const paths = ["src/components/data-unavailable.tsx"];
    const plan = createPlan(paths);
    expect(plan.tasks.find((task) => task.id === "unit")?.args).toContain(
      "tests/unit/changes-availability.test.tsx",
    );
    expect(selectedJourneys(paths)("heroes changes: recovery")).toBe(true);
  });
  it("checks nested cards when shared entity or tooltip behavior changes", () => {
    for (const path of [
      "src/components/ui/hover-tooltip.tsx",
      "src/components/attribute-link.tsx",
      "src/presentation/entity-preview.ts",
    ]) {
      const args = createPlan([path]).tasks.find(
        (task) => task.id === "unit",
      )?.args;
      expect(
        args?.length === 1 ||
          args?.includes("tests/unit/hover-tooltip.test.tsx"),
      ).toBe(true);
    }
  });

  it("checks change tables when contextual ranking or shared entity references change", () => {
    for (const path of [
      "src/components/entity-reference.tsx",
      "src/presentation/change-impact.ts",
      "src/presentation/change-notes.ts",
      "src/presentation/entity-preview.ts",
    ]) {
      expect(
        selectedJourneys([path])("heroes changes: compact entity tables"),
      ).toBe(true);
    }
    const plan = createPlan(["src/components/changes-table.tsx"]);
    expect(plan.tasks.find((task) => task.id === "unit")?.args).toContain(
      "tests/unit/infinite-list.test.tsx",
    );
  });
  it("checks attribute navigation and unit coverage when attribute label or unresolved evidence resources change", () => {
    for (const path of [
      "src/data/attribute-parameters/supplement.v1.json",
      "src/data/attribute-parameters/unresolved.v1.json",
      "src/data/attribute-parameters/contextual-labels.tsv",
      "src/data/attribute-parameters/field-labels.v1.json",
      "src/data/attribute-parameters/field-bindings.v1.json",
      "src/data/attribute-parameters/field-labels.tsv",
    ]) {
      expect(
        selectedJourneys([path])("attributes: pinned parameter names"),
      ).toBe(true);
      expect(createPlan([path]).tasks.map((task) => task.id)).toContain("unit");
    }
  });
  it("checks both item and attribute navigation when parameter label resources change", () => {
    const selected = selectedJourneys([
      "src/data/item-parameters/supplement.v1.json",
    ]);
    expect(selected("items: reviewed parameter labels")).toBe(true);
    expect(selected("attributes: item parameter details")).toBe(true);
  });
  it("checks publication orchestration with its fault tests, while exporter and unknown modules retain dynamic checks", () => {
    const plan = createPlan([
      "src/workers/push.ts",
      "src/development/publication/candidate.ts",
    ]);
    expect(plan.tasks.map((task) => task.id)).toEqual([
      "format",
      "lint",
      "docs",
      "types",
      "unit",
    ]);
    expect(plan.tasks.find((task) => task.id === "unit")?.args).toContain(
      "tests/unit/publication.test.ts",
    );
    expect(createPlan(["src/development/data-sync/publish.ts"]).browser).toBe(
      true,
    );
    expect(createPlan(["src/development/publication/future.ts"]).browser).toBe(
      true,
    );
    hiddenFiles.add("tests/unit/publication.test.ts");
    expect(createPlan(["src/workers/push.ts"]).browser).toBe(true);
  });
  it("checks visibility and refresh behavior when the workbench UI changes", () => {
    const plan = createPlan(["src/components/development-workbench.tsx"]);
    expect(plan.tasks.find((task) => task.id === "unit")?.args).toContain(
      "tests/unit/development-workbench.test.tsx",
    );
  });
  it("keeps documentation changes out of product setup and checks", () => {
    const plan = createPlan(["README.md", "docs/current.md"]);
    expect(plan.browser).toBe(false);
    expect(plan.database).toBe(false);
    expect(plan.tasks.map((task) => task.id)).toEqual(["format", "docs"]);
  });
  it("runs only the hero journey for an individual hero component", () => {
    const plan = createPlan(["src/components/hero-card.tsx"]);
    const selected = selectedJourneys(["src/components/hero-card.tsx"]);
    expect(selected("heroes: query, filter and open a detail")).toBe(true);
    expect(
      selected("heroes and abilities: readable tooltips and mobile layout"),
    ).toBe(true);
    expect(
      selected(
        "heroes global locale covers deep pages and preserves map state",
      ),
    ).toBe(false);
    expect(
      selected(
        "heroes changes: shared dropdowns submit and restore comparison filters",
      ),
    ).toBe(false);
    expect(selected("abilities: query, filter and open a detail")).toBe(false);
    expect(
      plan.tasks.some((task) =>
        ["build", "database", "benchmark"].includes(task.id),
      ),
    ).toBe(false);
  });
  it("checks both callers when a shared component is removed or renamed", () => {
    const plan = createPlan([
      "src/components/ui/deleted-panel.tsx",
      "src/components/panel.tsx",
    ]);
    const selected = selectedJourneys(plan.paths);
    for (const title of [
      "heroes: query",
      "abilities: query",
      "units: search",
      "items: search",
      "heroes releases: version navigation",
      "heroes global language persists across catalogs",
    ])
      expect(selected(title)).toBe(true);
    expect(plan.tasks.find((task) => task.id === "unit")?.args).toContain(
      "tests/unit/map-viewer.test.tsx",
    );
  });
  it("includes known parser answers, persistence and measurement for engine changes", () => {
    const plan = createPlan(["src/importers/dota-vpk/hero-adapter.ts"]);
    expect(plan.tasks.map((task) => task.id)).toEqual(
      expect.arrayContaining(["unit", "journeys", "database", "benchmark"]),
    );
    expect(plan.tasks.some((task) => task.id === "build")).toBe(false);
  });
  it("widens checks for migration and toolchain changes", () => {
    expect(
      createPlan(["drizzle/new.sql"]).tasks.some(
        (task) => task.id === "database-contract",
      ),
    ).toBe(true);
    expect(createPlan(["pnpm-lock.yaml"]).tasks.map((task) => task.id)).toEqual(
      expect.arrayContaining(["types", "unit", "journeys", "build"]),
    );
    expect(
      createPlan(["pnpm-workspace.yaml"]).tasks.map((task) => task.id),
    ).toContain("build");
  });
  it("executes changed integration and browser tests themselves", () => {
    const integration = createPlan(["tests/integration/deleted.test.ts"]);
    expect(
      integration.tasks.find((task) => task.id === "database")?.args,
    ).toEqual(["test:integration"]);
    const e2e = createPlan(["tests/e2e/heroes.spec.ts"]);
    expect(e2e.tasks.find((task) => task.id === "e2e")?.args).toEqual([
      "test:e2e",
      "--retries=1",
      "--project=desktop-chromium",
      "--project=mobile-chromium",
      "tests/e2e/heroes.spec.ts",
    ]);
  });
  it("checks both visual projects for page dependencies and brand assets, including deletions", () => {
    for (const path of [
      "src/app/globals.css",
      "src/components/catalog-header.tsx",
      "src/components/ability-tooltip.tsx",
      "public/brand/medota2-flowing-m.png",
      "public/brand/deleted-logo.png",
    ]) {
      const task = createPlan([path]).tasks.find(
        (task) => task.id === "visual",
      );
      expect(task?.args, path).toEqual([
        "test:e2e",
        "tests/e2e/visual.spec.ts",
        "--project=desktop-chromium",
        "--project=mobile-chromium",
        "--retries=1",
      ]);
      expect(task?.inputs).toContain("public");
    }
    for (const path of [
      "src/components/map/map-viewer.tsx",
      "src/components/unit-catalog.tsx",
      "src/server/repositories/items.ts",
      "docs/current.md",
    ]) {
      expect(
        createPlan([path]).tasks.some((task) => task.id === "visual"),
        path,
      ).toBe(false);
    }
  });
  it("routes snapshot changes to their owning spec and avoids duplicate visual runs", () => {
    const snapshot =
      "tests/e2e/visual.spec.ts-snapshots/heroes-catalog-desktop-chromium-darwin.png";
    const plan = createPlan(["src/components/catalog-header.tsx", snapshot]);
    expect(plan.tasks.some((task) => task.id === "visual")).toBe(false);
    expect(plan.tasks.find((task) => task.id === "e2e")?.args).toContain(
      "tests/e2e/visual.spec.ts",
    );
    expect(plan.tasks.find((task) => task.id === "e2e")?.args).not.toContain(
      snapshot,
    );
    expect(
      createPlan([
        "src/components/catalog-header.tsx",
        "tests/e2e/heroes.spec.ts",
      ]).tasks.some((task) => task.id === "visual"),
    ).toBe(true);
  });
  it("checks map algorithms without Catalog work and maps interactive UI to its browser flow", () => {
    for (const file of [
      "src/domain/map/routing.ts",
      "src/components/map/map-viewer.tsx",
      "src/server/map/packages.ts",
      "src/importers/dota-map/native.ts",
    ]) {
      const plan = createPlan([file]);
      const args = plan.tasks.find((task) => task.id === "unit")?.args;
      expect(args).toContain("tests/unit/map-routing.test.ts");
      expect(args).toContain("tests/unit/map-viewer.test.tsx");
      expect(args).not.toContain("tests/unit/hero-adapter.test.ts");
      expect(plan.browser).toBe(file === "src/components/map/map-viewer.tsx");
      expect(plan.tasks.some((task) => task.id === "database")).toBe(false);
      expect(plan.tasks.some((task) => task.id === "benchmark")).toBe(false);
    }
  });
  it("retains persistence checks when map code reads Catalog metadata", () => {
    const plan = createPlan(["src/server/map/store.ts"]);
    expect(plan.tasks.map((task) => task.id)).toContain("database");
    expect(plan.tasks.find((task) => task.id === "unit")?.args).toEqual([
      "test",
    ]);
  });
  it("selects unit source and asset checks and the unit journey", () => {
    const plan = createPlan(["src/server/repositories/units.ts"]);
    expect(plan.tasks.find((task) => task.id === "unit")?.args).toEqual(
      expect.arrayContaining([
        "tests/unit/unit-source.test.ts",
        "tests/unit/unit-assets.test.ts",
      ]),
    );
    const selected = selectedJourneys(plan.paths);
    expect(
      selected("units: search, clear, filter, open detail and follow ability"),
    ).toBe(true);
    expect(selected("heroes: query, filter and open a detail")).toBe(false);
    expect(plan.tasks.map((task) => task.id)).toContain("database");
  });
  it("widens mixed, unknown and removed dependencies instead of hiding them", () => {
    const mixed = createPlan([
      "src/domain/map/routing.ts",
      "src/lib/renamed-helper.ts",
    ]);
    expect(mixed.tasks.find((task) => task.id === "unit")?.args).toEqual([
      "test",
    ]);
    expect(mixed.tasks.map((task) => task.id)).toContain("database");
    expect(
      createPlan(["tests/unit/removed.test.ts"]).tasks.find(
        (task) => task.id === "unit",
      )?.args,
    ).toEqual(["test"]);
    expect(
      createPlan([
        "src/domain/map/removed.ts",
        "src/domain/map/new.ts",
      ]).tasks.find((task) => task.id === "unit")?.args,
    ).toContain("tests/unit/map-routing.test.ts");
  });
  it("keeps documentation tooling independent of product services", () => {
    const plan = createPlan(["scripts/documentation/check.mjs"]);
    expect(plan.tasks.map((task) => task.id)).toEqual([
      "format",
      "lint",
      "docs",
      "docs-tests",
    ]);
    expect(plan.browser).toBe(false);
    expect(plan.database).toBe(false);
  });
  it("keeps a reviewed label and translation change on existing component/resource tests", () => {
    const plan = createPlan([
      "src/components/ui/dataset-badge.tsx",
      "src/i18n/en.json",
      "tests/unit/dataset-badge.test.tsx",
      "docs/specs/semantic-game-ui.md",
    ]);
    expect(plan.browser).toBe(false);
    expect(plan.database).toBe(false);
    expect(plan.tasks.map((task) => task.id)).toEqual([
      "format",
      "lint",
      "docs",
      "types",
      "unit",
    ]);
    expect(plan.tasks.find((task) => task.id === "unit")?.args).toEqual([
      "test",
      "tests/unit/dataset-badge.test.tsx",
      "tests/unit/i18n.test.ts",
      "tests/unit/i18n-resources.test.ts",
    ]);
  });
  it("distinguishes translation resources from language routing and rendering", () => {
    expect(createPlan(["src/i18n/en.json"]).browser).toBe(false);
    for (const path of [
      "src/i18n/provider.tsx",
      "src/i18n/locale.ts",
      "src/proxy.ts",
    ]) {
      const selected = selectedJourneys([path]);
      expect(
        selected(
          "heroes global language persists across catalogs, details, history and reload",
        ),
      ).toBe(true);
      expect(
        selected(
          "heroes global locale covers deep pages and preserves map state",
        ),
      ).toBe(true);
    }
  });
  it("widens mixed label changes for unknown/shared code and includes newly named journeys", () => {
    for (const path of [
      "src/components/ui/new-widget.tsx",
      "src/app/layout.tsx",
      "src/i18n/new-runtime.ts",
    ]) {
      const plan = createPlan([
        "src/components/ui/dataset-badge.tsx",
        "src/i18n/en.json",
        path,
      ]);
      expect(plan.browser).toBe(true);
    }
    const plan = createPlan(["tests/journeys/new-flow.spec.ts"]);
    expect(
      plan.tasks.find((task) => task.id === "journeys")?.args,
    ).not.toContain("--grep");
    expect(
      selectedJourneys(plan.paths)("a completely new workflow title"),
    ).toBe(true);
  });
  it("checks the planner with its boundary tests without starting the product", () => {
    const plan = createPlan([
      "scripts/development/check-plan.mjs",
      "tests/unit/development-check-plan.test.ts",
    ]);
    expect(plan.browser).toBe(false);
    expect(plan.database).toBe(false);
    expect(plan.tasks.find((task) => task.id === "unit")?.args).toEqual([
      "test",
      "tests/unit/development-check-plan.test.ts",
    ]);
    expect(plan.tasks.some((task) => task.id === "build")).toBe(false);
    // Runner/build changes retain the broad toolchain checks.
    expect(
      createPlan(["src/workers/run-check.ts"]).tasks.some(
        (task) => task.id === "build",
      ),
    ).toBe(true);
  });
  it("retries only failed browser cases once within the same validated run", () => {
    expect(
      createPlan(["src/components/hero-card.tsx"]).tasks.find(
        (task) => task.id === "journeys",
      )?.args,
    ).toContain("--retries=1");
  });
  it("falls back to broad validation when a registered source or its test is missing", () => {
    for (const path of [
      "src/components/ui/dataset-badge.tsx",
      "tests/unit/dataset-badge.test.tsx",
    ]) {
      hiddenFiles.add(path);
      expect(createPlan(["src/components/ui/dataset-badge.tsx"]).browser).toBe(
        true,
      );
      hiddenFiles.clear();
    }
    hiddenFiles.add("tests/unit/development-check-plan.test.ts");
    expect(
      createPlan(["scripts/development/check-plan.mjs"]).tasks.some(
        (task) => task.id === "build",
      ),
    ).toBe(true);
  });
});

it("checks production CSS compilation without widening ordinary component edits", () => {
  for (const path of [
    "src/components/catalog-table-header.module.css",
    "src/app/globals.css",
    "src/components/deleted.module.css",
  ])
    expect(createPlan([path]).tasks.some((task) => task.id === "build")).toBe(
      true,
    );
  expect(
    createPlan(["src/components/catalog-table-header.tsx"]).tasks.some(
      (task) => task.id === "build",
    ),
  ).toBe(false);
});

it("selects the attributes journey for attribute routes and item value mapping", () => {
  for (const file of [
    "src/app/attributes/page.tsx",
    "src/importers/dota-vpk/item-adapter.ts",
    "src/domain/attributes.ts",
  ])
    expect(
      selectedJourneys([file])("attributes: links and versioned mechanics"),
    ).toBe(true);
});

it("routes reusable table changes to grouped-table coverage and changes journeys", () => {
  for (const path of [
    "src/components/ui/data-table.tsx",
    "src/components/ui/grouped-table.tsx",
    "src/components/ui/table-sticky-cells.ts",
    "src/components/ui/table-cell-spans.ts",
  ]) {
    const plan = createPlan([path]);
    expect(plan.tasks.find((task) => task.id === "unit")?.args).toContain(
      "tests/unit/grouped-table.test.tsx",
    );
    expect(
      selectedJourneys([path])("heroes changes: sticky merged items"),
    ).toBe(true);
  }
});

it("includes vision lifecycle checks and the map browser flow for Web vision inputs", () => {
  for (const path of [
    "src/components/map/vision-panel.tsx",
    "src/components/map/vision.worker.ts",
    "src/server/map/vision.ts",
  ]) {
    const plan = createPlan([path]);
    const unit = plan.tasks.find((task) => task.id === "unit")!;
    expect(unit.args).toContain("tests/unit/map-vision-client.test.ts");
    expect(unit.args).toContain("tests/unit/map-vision-panel.test.tsx");
    const browser = plan.tasks.find((task) => task.id === "journeys")!;
    expect(browser.args.join(" ")).toContain("map:");
    expect(plan.tasks.some((task) => task.id === "database")).toBe(false);
  }
  expect(warmRoutesForScopes(["map"])).toContain("map");
});

it("keeps map presets and minimap database assets within map journeys and their import checks", () => {
  for (const path of [
    "src/server/map/vision-presets.ts",
    "src/importers/valve-assets/hero-minimap-assets.ts",
    "src/app/map/hero-icons/[key]/route.ts",
  ]) {
    const plan = createPlan([path]);
    const args = plan.tasks.find((t) => t.id === "unit")!.args;
    expect(
      args.length === 1 ||
        args.includes("tests/unit/hero-minimap-assets.test.ts"),
    ).toBe(true);
    expect(
      plan.tasks.find((t) => t.id === "journeys")?.args.join(" "),
    ).toContain("map:");
  }
});
