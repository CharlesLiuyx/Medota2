import { describe, expect, it } from "vitest";
import { createRunId, createTestRunContext } from "@/testing/test-run-harness";

describe("Test Run Harness", () => {
  it("creates stable, valid, entropy-bearing Run Identities", () => {
    expect(
      createRunId("e2e", new Date("2026-08-31T05:13:14.123Z"), "abcdef12"),
    ).toBe("e2e-20260831t051314z-abcdef12");
    expect(() =>
      createRunId("e2e", new Date("2026-08-31T05:13:14Z"), "shared00"),
    ).toThrow(/entropy/u);
  });

  it("allocates non-overlapping run roots, projects, origins, and dist directories", async () => {
    const [first, second] = await Promise.all([
      createTestRunContext("integration", "/workspace/medota2", 31_001, 32_001),
      createTestRunContext("integration", "/workspace/medota2", 31_002, 32_002),
    ]);

    expect(first.runId).not.toBe(second.runId);
    expect(first.runRoot).not.toBe(second.runRoot);
    expect(first.composeProject).not.toBe(second.composeProject);
    expect(first.webOrigin).not.toBe(second.webOrigin);
    expect(first.databasePort).not.toBe(second.databasePort);
    expect(first.nextDistDirectory).not.toBe(second.nextDistDirectory);
    expect(first.nextTsconfigPath).not.toBe(second.nextTsconfigPath);
    expect(first.stateDirectory).toContain(`/${first.runId}/state`);
  });
});
