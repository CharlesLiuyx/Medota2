import { describe, expect, it } from "vitest";
import { balanceBrowserCases, listedCases } from "@/development/browser-shards";

const report = {
  config: { rootDir: "/workspace/tests/journeys" },
  suites: [
    {
      title: "example.spec.ts",
      suites: [
        {
          title: "navigation",
          specs: [
            {
              title: "returns",
              file: "example.spec.ts",
              tests: [{ projectName: "desktop" }, { projectName: "mobile" }],
            },
          ],
        },
      ],
    },
  ],
};
describe("browser duration sharding", () => {
  it("keeps new tests and both projects, uses stable identities rather than line numbers", () => {
    const cases = listedCases(
      report,
      "journeys",
      {
        "[desktop] › tests/journeys/example.spec.ts › navigation › returns": 20_000,
      },
      "/workspace",
    );
    expect(cases.map((test) => test.durationMs)).toEqual([20_000, 10_000]);
    expect(cases[0].listEntry).toBe(
      "[desktop] › example.spec.ts › navigation › returns",
    );
    const shards = balanceBrowserCases(cases, 6);
    expect(
      shards
        .flatMap((part) => part.cases)
        .map((test) => test.id)
        .sort(),
    ).toEqual(cases.map((test) => test.id).sort());
    expect(shards.filter((part) => !part.cases.length)).toHaveLength(4);
  });
  it("balances the combined suites and proves no duplicate or missing test", () => {
    const cases = [30, 25, 20, 15, 10, 5].map((seconds, i) => ({
      id: `test-${i}`,
      listEntry: `test-${i}`,
      taskId: i % 2 ? "e2e" : "journeys",
      durationMs: seconds * 1000,
    }));
    const shards = balanceBrowserCases(cases, 3);
    expect(shards.map((part) => part.durationMs)).toEqual([
      35_000, 35_000, 35_000,
    ]);
    expect(shards.flatMap((part) => part.cases)).toHaveLength(6);
    expect(balanceBrowserCases([...cases].reverse(), 3)).toEqual(shards);
    expect(() => balanceBrowserCases([...cases, cases[0]], 3)).toThrow(
      "Duplicate",
    );
    expect(() =>
      listedCases({ ...report, errors: ["load failed"] }, "journeys"),
    ).toThrow("discovery");
  });
});
