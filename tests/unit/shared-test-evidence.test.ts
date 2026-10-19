import { resolve } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writes: [] as Array<{ path: string; data: Record<string, unknown> | null }>,
  release: vi.fn(),
  fingerprint: vi.fn(),
  destroy: vi.fn(),
  retire: vi.fn(),
  run: vi.fn(),
  provision: vi.fn(),
}));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn() }));
vi.mock("@/testing/test-run-harness", () => ({
  createTestRunContext: async () => ({
    workspaceRoot: process.cwd(),
    runId: "fixture-test",
    runRoot: resolve(".medota2/unit-fixture"),
    stateDirectory: resolve(".medota2/unit-fixture/state"),
    webPort: 31999,
    nextDistDirectory: resolve(".medota2/unit-fixture/next"),
    nextTsconfigPath: resolve(".medota2/unit-fixture/tsconfig.json"),
  }),
}));
vi.mock("@/server/environment/data-stack-lifecycle", () => ({
  destroyDataStack: mocks.destroy,
  createDataStackPlan: () => ({ composeProject: "fixture-test" }),
  provisionDataStack: mocks.provision,
}));
vi.mock("@/development/storage", () => ({
  removeRetiredTestBuild: mocks.retire,
}));
vi.mock("@/development/runtime", () => ({
  acquireLock: async () => mocks.release,
  CommandAbortedError: class extends Error {},
  fingerprint: mocks.fingerprint,
  run: mocks.run,
  readJson: async () => null,
  writeJson: async (path: string, data: Record<string, unknown> | null) => {
    mocks.writes.push({ path, data: structuredClone(data) });
  },
}));
import {
  TestInputsChangedError,
  withTestEnvironment,
} from "@/development/test-environment";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.destroy.mockResolvedValue(undefined);
  mocks.provision.mockResolvedValue({ composeProject: "fixture-test" });
  mocks.run.mockResolvedValue(undefined);
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
  expect(receipts.map(({ data }) => data?.status)).toEqual([
    "running",
    "stale",
  ]);
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("publishes a passing receipt only after final validation, and preserves ordinary failures", async () => {
  const verify = vi.fn(async () => {
    expect(mocks.writes.some(({ data }) => data?.status === "passed")).toBe(
      false,
    );
  });
  await expect(
    withTestEnvironment(async () => "done", { seed: true, verify }),
  ).resolves.toBe("done");
  expect(verify).toHaveBeenCalledOnce();
  expect(
    mocks.writes.filter(({ path }) => path.endsWith("/run.json")).at(-1)?.data
      ?.status,
  ).toBe("passed");
  await expect(
    withTestEnvironment(
      async () => {
        throw new Error("runner failed");
      },
      { seed: true, verify },
    ),
  ).rejects.toThrow("runner failed");
  expect(verify).toHaveBeenCalledOnce();
  expect(
    mocks.writes.filter(({ path }) => path.endsWith("/run.json")).at(-1)?.data
      ?.status,
  ).toBe("failed");
});

it("retires the exact fixture lease after success, failure, and setup failure while holding its lock", async () => {
  mocks.destroy.mockImplementation(async () => {
    expect(mocks.release).not.toHaveBeenCalled();
  });
  await withTestEnvironment(async () => "done", { seed: true });
  expect(mocks.destroy).toHaveBeenCalledWith({
    composeProject: "fixture-test",
  });
  expect(mocks.retire).toHaveBeenCalledOnce();
  expect(mocks.writes.at(-1)?.data).toBeNull();
  mocks.release.mockClear();
  mocks.run.mockRejectedValueOnce(new Error("migration failed"));
  await expect(withTestEnvironment(async () => "unreachable")).rejects.toThrow(
    "migration failed",
  );
  expect(mocks.destroy).toHaveBeenCalledTimes(2);
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("retains the lease for retry if Docker cleanup fails and always releases the lock", async () => {
  mocks.destroy.mockRejectedValueOnce(new Error("Docker unavailable"));
  await expect(
    withTestEnvironment(async () => "done", { seed: true }),
  ).rejects.toThrow("Docker unavailable");
  expect(mocks.writes.some(({ data }) => data === null)).toBe(false);
  expect(mocks.retire).not.toHaveBeenCalled();
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("records the lease before provisioning and cleans it when startup is cancelled", async () => {
  const signal = new AbortController();
  mocks.provision.mockImplementationOnce(async () => {
    expect(mocks.writes[0].data).toMatchObject({
      lease: { composeProject: "fixture-test" },
    });
    signal.abort(new Error("cancelled during provision"));
    return { composeProject: "fixture-test" };
  });
  const work = vi.fn();
  await expect(
    withTestEnvironment(work, { signal: signal.signal }),
  ).rejects.toThrow("cancelled during provision");
  expect(work).not.toHaveBeenCalled();
  expect(mocks.destroy).toHaveBeenCalledOnce();
  expect(mocks.release).toHaveBeenCalledOnce();
});
