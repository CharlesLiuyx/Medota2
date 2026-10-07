import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  task: vi.fn(),
  fetchSnapshot: vi.fn(),
  dataGit: vi.fn(),
}));
vi.mock("@/development/data-sync/tasks", () => ({ taskProcess: mocks.task }));
vi.mock("@/development/data-sync/git", () => ({
  configureRepository: async () =>
    "https://github.com/example/private-data.git",
  readDataLock: async () => null,
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
