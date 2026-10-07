import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckPlan } from "../../scripts/development/check-plan.mjs";

const state = vi.hoisted(() => ({
  plan: undefined as CheckPlan | undefined,
  finished: undefined as { status: string } | undefined,
  release: vi.fn(async () => {}),
  acquireLock: vi.fn(),
  run: vi.fn(),
  readJson: vi.fn(),
}));
vi.mock("../../scripts/development/check-plan.mjs", () => ({
  parseArguments: () => ({ files: ["example.ts"] }),
  createPlan: () => state.plan,
  changedFiles: () => ["example.ts"],
}));
vi.mock("@/development/runtime", () => ({
  acquireLock: state.acquireLock,
  run: state.run,
  readJson: state.readJson,
  fingerprint: async () => "unchanged-input",
  writeJson: async (
    _path: string,
    value: { finishedAt?: string; status: string },
  ) => {
    if (value.finishedAt) state.finished = structuredClone(value);
  },
}));
function plan(kind: "static" | "browser"): CheckPlan {
  return {
    schemaVersion: 1,
    paths: ["example.ts"],
    tasks: [
      {
        id: "example",
        reason: "fixture",
        command: "pnpm",
        args: ["fixture"],
        inputs: ["example.ts"],
        kind,
      },
    ],
    browser: kind === "browser",
    database: kind === "browser",
    summary: "fixture",
  };
}
let exitCode: typeof process.exitCode;
let originalSignals: Map<"SIGINT" | "SIGTERM", Set<unknown>>;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  exitCode = process.exitCode;
  originalSignals = new Map(
    ["SIGINT", "SIGTERM"].map((signal) => [
      signal as "SIGINT" | "SIGTERM",
      new Set(process.listeners(signal)),
    ]),
  );
  state.finished = undefined;
  state.readJson.mockResolvedValue(null);
  state.acquireLock.mockResolvedValue(state.release);
  state.run.mockResolvedValue(undefined);
});
afterEach(() => {
  process.exitCode = exitCode;
  for (const [signal, listeners] of originalSignals) {
    for (const listener of process.listeners(signal))
      if (!listeners.has(listener)) process.off(signal, listener);
  }
});
async function execute() {
  await import("@/workers/run-check");
  await vi.waitFor(() => expect(state.finished).toBeDefined(), {
    timeout: 10_000,
  });
}
describe("incremental check runner", () => {
  it("runs static checks without waiting for the product checks lock", async () => {
    state.plan = plan("static");
    await execute();
    expect(state.acquireLock).not.toHaveBeenCalled();
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(state.finished?.status).toBe("passed");
  });
  it("reuses static evidence with unchanged inputs", async () => {
    state.plan = plan("static");
    state.readJson.mockResolvedValue({ status: "passed" });
    await execute();
    expect(state.run).not.toHaveBeenCalled();
    expect(state.finished?.status).toBe("passed");
  });
  it("serializes dynamic checks and revalidates them even if cached evidence exists", async () => {
    state.plan = plan("browser");
    state.readJson.mockResolvedValue({ status: "passed" });
    await execute();
    expect(state.acquireLock).toHaveBeenCalledWith("checks");
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(state.release).toHaveBeenCalledTimes(1);
  });
  it("marks evidence stale if scope expands while paths and content fingerprints stay the same", async () => {
    state.plan = plan("static");
    state.run.mockImplementation(async () => {
      state.plan = plan("browser");
    });
    await execute();
    expect(state.finished?.status).toBe("stale");
    expect(process.exitCode).toBe(2);
  });
});
