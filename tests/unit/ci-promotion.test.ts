import { describe, expect, it } from "vitest";
import {
  candidateBase,
  coreLanesForPlan,
  browserShardsForPlan,
  benchmarkFile,
  reusableCandidate,
} from "../../scripts/development/ci-plan.mjs";
import {
  createPlan,
  executionPlan,
} from "../../scripts/development/check-plan.mjs";
const base = "a".repeat(40);
const target = {
  sha: "target",
  base,
  workflowId: 123,
  repository: "owner/repo",
};
const success = {
  head_sha: "target",
  event: "push",
  status: "completed",
  conclusion: "success",
  workflow_id: 123,
  head_repository: { full_name: "owner/repo" },
  head_branch: `codex/publish/${base}/123-deadbeef`,
};
describe("CI promotion evidence", () => {
  it("reduces hosts for bounded modules without changing the selected task union", () => {
    expect(browserShardsForPlan(createPlan(["docs/current.md"]))).toEqual([]);
    expect(
      browserShardsForPlan(createPlan(["src/domain/hero-build.ts"])),
    ).toEqual([1, 2]);
    expect(
      browserShardsForPlan(createPlan(["src/workers/run-check.ts"])),
    ).toEqual([1, 2, 3, 4, 5, 6]);
    expect(benchmarkFile("full")).toBe("src/workers/run-check.ts");
    expect(() => benchmarkFile("arbitrary")).toThrow("Unknown CI benchmark");
    expect(
      reusableCandidate({ ...success, event: "workflow_dispatch" }, target),
    ).toBe(false);
  });
  it("runs each selected core task once across independent static and runtime hosts", () => {
    const plan = createPlan(["src/development/warm-browser.ts"]);
    const lanes = coreLanesForPlan(plan);
    expect(lanes).toEqual(["static", "runtime"]);
    const tasks = lanes.flatMap((lane) => executionPlan(plan, { lane }).tasks);
    expect(tasks.map((task) => task.id).sort()).toEqual(
      executionPlan(plan, { lane: "core" })
        .tasks.map((task) => task.id)
        .sort(),
    );
    expect(executionPlan(plan, { lane: "static" }).database).toBe(false);
    expect(
      executionPlan(plan, { lane: "runtime" }).tasks.map((task) => task.id),
    ).toEqual(["database", "build"]);
  });
  it("keeps documentation on a single static host and omits empty core work", () => {
    expect(coreLanesForPlan(createPlan(["docs/current.md"]))).toEqual([
      "static",
    ]);
    const plan = createPlan(["docs/current.md"]);
    expect(coreLanesForPlan({ ...plan, tasks: [] })).toEqual([]);
  });
  it("binds candidate base, SHA, repository and workflow", () => {
    expect(reusableCandidate(success, target)).toBe(true);
    expect(candidateBase(success.head_branch)).toBe(base);
    expect(candidateBase("codex/publish/HEAD/123-deadbeef")).toBeUndefined();
    for (const change of [
      { head_sha: "other" },
      { head_branch: "main" },
      { head_branch: `codex/publish/${"b".repeat(40)}/123-deadbeef` },
      { event: "pull_request" },
      { status: "in_progress" },
      { conclusion: "failure" },
      { conclusion: "cancelled" },
      { conclusion: "skipped" },
      { workflow_id: 456 },
      { head_repository: { full_name: "fork/repo" } },
    ])
      expect(reusableCandidate({ ...success, ...change }, target)).toBe(false);
  });
});
