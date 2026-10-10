import { resolve } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writes: [] as Array<{ path: string; data: Record<string, unknown> }>,
  release: vi.fn(),
  fingerprint: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn() }));
vi.mock("node:util", () => ({
  promisify: () => async (_command: string, args: string[]) => ({
    stdout: args[0] === "inspect" ? "started" : "container",
  }),
}));
vi.mock("@/testing/test-run-harness", () => ({
  createTestRunContext: vi.fn(),
}));
vi.mock("@/server/environment/data-stack-lifecycle", () => ({
  destroyDataStack: vi.fn(),
  provisionDataStack: vi.fn(),
}));
vi.mock("@/development/runtime", () => ({
  acquireLock: async () => mocks.release,
  fingerprint: mocks.fingerprint,
  run: vi.fn(),
  readJson: async () => ({
    context: {
      workspaceRoot: process.cwd(),
      runId: "fixture-test",
      runRoot: resolve(".medota2/unit-fixture"),
      stateDirectory: resolve(".medota2/unit-fixture/state"),
      webPort: 31999,
      nextDistDirectory: resolve(".medota2/unit-fixture/next"),
      nextTsconfigPath: resolve(".medota2/unit-fixture/tsconfig.json"),
    },
    lease: { composeProject: "fixture-test" },
    dockerStartedAt: "started",
    seededInput: "fixture",
  }),
  writeJson: async (path: string, data: Record<string, unknown>) => {
    mocks.writes.push({ path, data: structuredClone(data) });
  },
}));
import {
  TestInputsChangedError,
  withTestEnvironment,
} from "@/development/test-environment";

beforeEach(() => {
  mocks.writes.length = 0;
  mocks.release.mockClear();
  mocks.fingerprint.mockResolvedValue("fixture");
});

it("records stale instead of passed when validation detects changed inputs after a successful runner", async () => {
  const work = vi.fn(async () => "runner passed");
  await expect(
    withTestEnvironment(work, {
      seed: true,
      verify: async () => {
        expect(mocks.release).not.toHaveBeenCalled();
        throw new TestInputsChangedError();
      },
    }),
  ).rejects.toThrow(/stale/);
  expect(work).toHaveBeenCalledOnce();
  const receipts = mocks.writes.filter(({ path }) =>
    path.endsWith("/run.json"),
  );
  expect(receipts.map(({ data }) => data.status)).toEqual(["running", "stale"]);
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("publishes a passing receipt only after final validation, and preserves ordinary failures", async () => {
  const verify = vi.fn(async () => {
    expect(mocks.writes.some(({ data }) => data.status === "passed")).toBe(
      false,
    );
  });
  await expect(
    withTestEnvironment(async () => "done", { seed: true, verify }),
  ).resolves.toBe("done");
  expect(verify).toHaveBeenCalledOnce();
  expect(mocks.writes.at(-1)?.data.status).toBe("passed");
  await expect(
    withTestEnvironment(
      async () => {
        throw new Error("runner failed");
      },
      { seed: true, verify },
    ),
  ).rejects.toThrow("runner failed");
  expect(verify).toHaveBeenCalledOnce();
  expect(mocks.writes.at(-1)?.data.status).toBe("failed");
});
