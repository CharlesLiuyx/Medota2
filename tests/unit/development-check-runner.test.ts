import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckPlan } from "../../scripts/development/check-plan.mjs";

const state = vi.hoisted(() => ({
  plan: undefined as CheckPlan | undefined,
  finished: undefined as { status: string } | undefined,
  release: vi.fn(async () => {}),
  acquireLock: vi.fn(),
  run: vi.fn(),
  readJson: vi.fn(),
  input: "unchanged-input",
}));
vi.mock("../../scripts/development/check-plan.mjs", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../scripts/development/check-plan.mjs")
  >()),
  parseArguments: () => ({ files: ["example.ts"] }),
  createPlan: () => state.plan,
  changedFiles: () => ["example.ts"],
}));
vi.mock("@/development/runtime", () => ({
  acquireLock: state.acquireLock,
  run: state.run,
  readJson: state.readJson,
  fingerprint: async () => state.input,
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
  state.input = "unchanged-input";
  state.readJson.mockResolvedValue(null);
  state.acquireLock.mockResolvedValue(state.release);
  state.run.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
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
  it("stops after a stale task instead of running the remaining expensive tasks", async () => {
    state.plan = plan("static");
    state.plan.tasks.push({
      ...state.plan.tasks[0],
      id: "later-browser",
      kind: "browser",
    });
    state.run.mockImplementation(async () => {
      state.input = "changed-input";
    });
    await execute();
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(state.finished?.status).toBe("stale");
    expect(process.exitCode).toBe(1);
  });

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
    expect(state.acquireLock).toHaveBeenCalledWith(
      "checks",
      undefined,
      expect.any(AbortSignal),
    );
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(state.release).toHaveBeenCalledTimes(1);
  });
  it("cancels and joins a real journey when the concurrent build fails, without starting later tasks", async () => {
    vi.stubEnv("CI", "");
    state.plan = plan("browser");
    state.plan.tasks[0].id = "journeys";
    state.plan.tasks[0].args = ["journey"];
    state.plan.tasks.push({
      ...state.plan.tasks[0],
      id: "build",
      kind: "build",
      args: ["build"],
    });
    state.plan.tasks.push({
      ...state.plan.tasks[0],
      id: "database",
      kind: "database",
      args: ["database"],
    });
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let cleaned = false;
    state.run.mockImplementation(
      async (_command, args, _env, _log, signal: AbortSignal) => {
        if (args[0] === "build") {
          await started;
          throw new Error("build failed");
        }
        ready();
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        cleaned = true;
        throw new Error("cancelled");
      },
    );
    await execute();
    expect(state.run).toHaveBeenCalledTimes(2);
    expect(cleaned).toBe(true);
    expect(state.release).toHaveBeenCalledTimes(1);
    expect(state.finished?.status).toBe("failed");
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
