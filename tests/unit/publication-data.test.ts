import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  task: vi.fn(),
  lock: vi.fn(async (): Promise<unknown> => null),
  fetchSnapshot: vi.fn(),
  dataGit: vi.fn(),
}));
vi.mock("@/development/data-sync/tasks", () => ({ taskProcess: mocks.task }));
vi.mock("@/development/data-sync/git", () => ({
  configureRepository: async () =>
    "https://github.com/example/private-data.git",
  readDataLock: mocks.lock,
  fetchSnapshot: mocks.fetchSnapshot,
  dataGit: mocks.dataGit,
  hasManagedChanges: async () => false,
}));
vi.mock("node:child_process", () => ({
  execFile: (
    _command: string,
    _args: string[],
    _options: unknown,
    callback: (error: null, output: { stdout: string }) => void,
  ) => callback(null, { stdout: "" }),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mocks.lock.mockResolvedValue(null);
});
it("rejects changed business content before any upload or lock update", async () => {
  vi.stubEnv("GH_TOKEN", "test-token-never-sent");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ private: true }))),
  );
  mocks.task.mockResolvedValue({ snapshotId: "different-from-validated" });
  const { publishData } = await import("@/development/data-sync/publish");
  await expect(
    publishData({ expectedSnapshotId: "validated-snapshot" }),
  ).rejects.toThrow("Business data changed");
  expect(mocks.dataGit).not.toHaveBeenCalled();
  expect(mocks.fetchSnapshot).not.toHaveBeenCalled();
});

it.each([false, true])(
  "reuses this invocation's unchanged export, retaining independent remote and live digest checks (drift=%s)",
  async (drift) => {
    vi.stubEnv("GH_TOKEN", "test-token-never-sent");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ private: true }))),
    );
    const { publishData } = await import("@/development/data-sync/publish");
    const { mapDigest } = await import("@/development/data-sync/maps");
    const lock = { snapshotId: "same-snapshot", commit: "remote-commit" };
    mocks.lock.mockResolvedValue(lock);
    const prepared = {
      snapshotId: lock.snapshotId,
      manifest: { databaseDigest: "original", map: null },
    } as unknown as NonNullable<Parameters<typeof publishData>[0]>["prepared"];
    mocks.task.mockResolvedValue({
      databaseDigest: drift ? "modified" : "original",
      mapDigest: mapDigest(null),
    });
    const result = publishData({
      expectedSnapshotId: lock.snapshotId,
      prepared,
    });
    if (drift) await expect(result).rejects.toThrow("Local data changed");
    else await expect(result).resolves.toEqual({ lock, changed: false });
    expect(mocks.fetchSnapshot).toHaveBeenCalledWith(lock);
    expect(mocks.task.mock.calls.map(([operation]) => operation)).toEqual([
      "inspect",
    ]);
    expect(mocks.dataGit).not.toHaveBeenCalled();
  },
);
