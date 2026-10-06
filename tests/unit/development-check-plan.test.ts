import { describe, expect, it } from "vitest";
import { createPlan } from "../../scripts/development/check-plan.mjs";

describe("development check scope", () => {
  it("keeps documentation changes out of product setup and checks", () => {
    const plan = createPlan(["README.md", "docs/current.md"]);
    expect(plan.browser).toBe(false);
    expect(plan.database).toBe(false);
    expect(plan.tasks.map((task) => task.id)).toEqual(["format", "docs"]);
  });
  it("runs only the hero journey for an individual hero component", () => {
    const plan = createPlan(["src/components/hero-card.tsx"]);
    expect(plan.tasks.find((task) => task.id === "journeys")?.args.at(-1)).toBe(
      "heroes",
    );
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
    expect(plan.tasks.find((task) => task.id === "journeys")?.args.at(-1)).toBe(
      "heroes|abilities|units",
    );
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
      "tests/e2e/heroes.spec.ts",
    ]);
  });
  it("checks file-backed map algorithms and UI without Catalog work", () => {
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
      expect(plan.browser).toBe(false);
      expect(plan.database).toBe(false);
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
    expect(plan.tasks.find((task) => task.id === "journeys")?.args.at(-1)).toBe(
      "units",
    );
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
});
