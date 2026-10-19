import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Suite } from "@playwright/test/reporter";
import FailureReporter from "../helpers/failure-reporter";
import { describe, expect, it, vi } from "vitest";
import {
  retryPlan,
  validateFailedCheck,
  type FailedCheck,
} from "@/development/check-retry";
import {
  createPlan,
  executionPlan,
  parseArguments,
} from "../../scripts/development/check-plan.mjs";

const receipt: FailedCheck = {
  schemaVersion: 1,
  status: "failed",
  paths: ["tests/journeys/catalog-views.spec.ts"],
  tasks: [
    {
      id: "journeys",
      status: "failed",
      failedCases: [
        {
          title: "heroes: search (cold)",
          file: "ignored",
          project: "desktop-chromium",
        },
      ],
    },
  ],
};
describe("failure diagnosis planning", () => {
  it("selects only static tasks before publication without changing the complete plan", () => {
    const plan = createPlan(["src/workers/run-check.ts"]);
    expect(plan.tasks.some((task) => task.kind === "build")).toBe(true);
    const preflight = executionPlan(plan, { lane: "static" });
    expect(preflight.tasks.length).toBeGreaterThan(2);
    expect(preflight.tasks.every((task) => task.kind === "static")).toBe(true);
    expect(preflight.database).toBe(false);
    expect(preflight.browser).toBe(false);
  });
  it("replans trusted commands and reruns a failed journey against fixture and real data", () => {
    const result = retryPlan(createPlan(receipt.paths), receipt);
    expect(result.tasks.map((task) => task.id)).toEqual([
      "journeys-fixture",
      "journeys",
    ]);
    expect(result.tasks[0].args).toContain("--fixture");
    expect(result.tasks[1].args).not.toContain("--fixture");
    for (const task of result.tasks) {
      const pattern = task.args[task.args.indexOf("--grep") + 1];
      expect(new RegExp(pattern).test("heroes: search (cold)")).toBe(true);
      expect(new RegExp(pattern).test("heroes: search cold")).toBe(false);
      expect(task.args).not.toContain("--pass-with-no-tests");
    }
  });
  it("rejects passed/stale receipts, removed tasks, and ambiguous scopes", () => {
    for (const status of ["passed", "stale", "running"])
      expect(() => validateFailedCheck({ ...receipt, status })).toThrow();
    expect(() => retryPlan(createPlan(["README.md"]), receipt)).toThrow(
      "已不在当前计划",
    );
    expect(() =>
      parseArguments(["--retry-failed", "x", "--base", "HEAD"]),
    ).toThrow();
    expect(parseArguments(["--retry-failed", "x"]).retryFailed).toBe("x");
  });
});

it.each([false, true])(
  "records blocking outcomes for targeted diagnosis (failOnFlakyTests=%s)",
  async (failOnFlakyTests) => {
    const root = await mkdtemp(join(tmpdir(), "medota-failure-report-"));
    try {
      const file = join(root, "failures.json");
      vi.stubEnv("MEDOTA2_CHECK_FAILURE_FILE", file);
      const reporter = new FailureReporter();
      reporter.onBegin({ failOnFlakyTests }, {
        allTests: () =>
          ["unexpected", "flaky", "expected", "skipped"].map((outcome) => ({
            title: `case ${outcome}`,
            location: { file: "tests/journeys/example.spec.ts" },
            outcome: () => outcome,
            results: [{ duration: 12 }],
            parent: { project: () => ({ name: "desktop-chromium" }) },
          })),
      } as unknown as Suite);
      reporter.onEnd();
      expect(JSON.parse(await readFile(file, "utf8"))).toEqual(
        ["unexpected", ...(failOnFlakyTests ? ["flaky"] : [])].map(
          (outcome) => ({
            title: `case ${outcome}`,
            file: "tests/journeys/example.spec.ts",
            project: "desktop-chromium",
          }),
        ),
      );
      expect(
        JSON.parse(await readFile(`${file}.timings.json`, "utf8")),
      ).toEqual(
        ["unexpected", "flaky", "expected", "skipped"].map((outcome) => ({
          file: "tests/journeys/example.spec.ts",
          project: "desktop-chromium",
          titlePath: [`case ${outcome}`],
          durationMs: 12,
          outcome,
          attempts: 1,
        })),
      );
    } finally {
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  },
);
