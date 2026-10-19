import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withBrowserBatch } from "@/development/browser-batch";

const state = vi.hoisted(() => ({
  run: vi.fn(),
  warm: vi.fn(),
  lease: vi.fn(),
  stopped: false,
}));
vi.mock("@/development/runtime", () => ({
  run: state.run,
  CommandAbortedError: class CommandAbortedError extends Error {},
}));
vi.mock("@/development/warm-browser", () => ({
  warmBrowserOrigin: state.warm,
}));
vi.mock("@/development/test-environment", () => ({
  withTestEnvironment: state.lease,
}));
beforeEach(async () => {
  vi.clearAllMocks();
  state.stopped = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    })),
  );
  state.lease.mockImplementation(async (work) => {
    try {
      await work({
        MEDOTA2_TEST_WEB_PORT: "0",
        MEDOTA2_ARTIFACT_ROOT: "/tmp/browser-batch",
      });
    } finally {
      expect(state.stopped).toBe(true);
    }
  });
  state.warm.mockResolvedValue(undefined);
  const { CommandAbortedError } = await import("@/development/runtime");
  state.run.mockImplementation(
    async (_command, _args, _env, _log, signal: AbortSignal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      state.stopped = true;
      throw new CommandAbortedError("stopped");
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("owned browser batch", () => {
  it("prepares once and keeps the fixture lease until the server has stopped", async () => {
    const work = vi.fn(async (env, signal) => {
      expect(env.MEDOTA2_FIXTURE_BROWSER_BATCH).toBe("1");
      expect(signal.aborted).toBe(false);
      expect(state.stopped).toBe(false);
    });
    await withBrowserBatch(work, new AbortController().signal);
    expect(state.lease).toHaveBeenCalledTimes(1);
    expect(state.run).toHaveBeenCalledTimes(1);
    expect(state.warm).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledTimes(1);
  });
  it("stops the server before releasing a failed suite", async () => {
    await expect(
      withBrowserBatch(async () => {
        throw new Error("suite failed");
      }, new AbortController().signal),
    ).rejects.toThrow("suite failed");
    expect(state.stopped).toBe(true);
  });
  it("forwards cancellation to active work and waits for its owned server", async () => {
    const controller = new AbortController();
    await expect(
      withBrowserBatch(
        async (_env, signal) => {
          controller.abort(new Error("cancelled by owner"));
          expect(signal.aborted).toBe(true);
          signal.throwIfAborted();
        },
        controller.signal,
        ["attributes"],
      ),
    ).rejects.toThrow("cancelled by owner");
    expect(state.warm).toHaveBeenCalledWith("http://127.0.0.1:0", [
      "attributes",
    ]);
    expect(state.stopped).toBe(true);
  });
  it("cancels active suites when the owned server exits", async () => {
    state.run.mockImplementation(async () => {
      state.stopped = true;
      throw new Error("server crashed");
    });
    const work = vi.fn();
    await expect(
      withBrowserBatch(work, new AbortController().signal),
    ).rejects.toThrow("server crashed");
    expect(work).not.toHaveBeenCalled();
  });
  it("does not swallow process cleanup failures", async () => {
    state.run.mockImplementation(
      async (_command, _args, _env, _log, signal: AbortSignal) => {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        state.stopped = true;
        throw new Error("owned group has not exited");
      },
    );
    await expect(
      withBrowserBatch(async () => {}, new AbortController().signal),
    ).rejects.toThrow("owned group has not exited");
  });
});
