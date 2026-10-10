import { expect, it } from "vitest";
import { normalizeTestRunnerArgs } from "@/development/test-runner-args";

it("preserves test paths, project selection and filters with or without the pnpm separator", () => {
  const args = [
    "tests/e2e/heroes.spec.ts",
    "--project=mobile-chromium",
    "--grep",
    "compact hero previews",
    "--list",
  ];
  expect(normalizeTestRunnerArgs(args)).toEqual(args);
  expect(normalizeTestRunnerArgs(["--", ...args])).toEqual(args);
  expect(normalizeTestRunnerArgs([])).toEqual([]);
});

it("rejects interior or repeated separators before a runner can silently expand the test scope", () => {
  expect(() =>
    normalizeTestRunnerArgs(["--", "--", "--project=missing"]),
  ).toThrow(/separator/);
  expect(() =>
    normalizeTestRunnerArgs([
      "tests/e2e/heroes.spec.ts",
      "--",
      "--project=missing",
    ]),
  ).toThrow(/separator/);
});
