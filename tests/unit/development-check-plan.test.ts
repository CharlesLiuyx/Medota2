import { describe, expect, it } from "vitest";
import { createPlan } from "../../scripts/development/check-plan.mjs";

describe("development check scope", () => {
  it("keeps documentation changes out of product setup and checks", () => {
    const plan = createPlan(["README.md", "docs/current.md"]);
    expect(plan.browser).toBe(false);
    expect(plan.database).toBe(false);
    expect(plan.tasks.map((task) => task.id)).toEqual(["format"]);
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
      "heroes|abilities",
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
});
