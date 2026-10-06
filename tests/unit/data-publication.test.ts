import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  canonical,
  digest,
  sha256,
  snapshotId,
  type SnapshotManifest,
} from "@/development/data-sync/protocol";
import { schemaDigest, tables } from "@/development/data-sync/schema";
import { migrationDigest } from "@/development/data-sync/database";
import { publishData } from "@/development/data-sync/publish";

const state = vi.hoisted(() => ({
  root: "",
  current: null as null | {
    root: string;
    snapshotId: string;
    manifestSha256: string;
    manifest: SnapshotManifest;
  },
  previous: null as unknown,
  changed: false,
  writes: [] as Array<{ path: string; value: unknown }>,
  fetchSnapshot: vi.fn(),
}));
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: (
    _command: string,
    _args: string[],
    _options: unknown,
    callback: (error: null, output: object) => void,
  ) => {
    callback(null, { stdout: "", stderr: "" });
  },
}));
vi.mock("@/config/data-sync-state", async (original) => ({
  ...(await original<typeof import("@/config/data-sync-state")>()),
  syncRoot: () => state.root,
}));
vi.mock("@/development/data-sync/git", () => ({
  configureRepository: async () =>
    "https://github.com/fixture/private-data.git",
  readDataLock: async () => state.previous,
  hasManagedChanges: async () => false,
  fetchSnapshot: state.fetchSnapshot,
  dataGit: async (args: string[], root: string, isolated: boolean) => {
    if (args.join(" ") === "remote get-url origin")
      return "https://github.com/fixture/private-data.git";
    if (args[0] === "ls-remote") return `${"c".repeat(40)}\t${args[2]}`;
    if (args[0] === "rev-parse") throw new Error("No local snapshot ref");
    if (args[0] === "checkout" && isolated) {
      const path = resolve(
        root,
        "snapshots",
        state.current!.snapshotId,
        "manifest.json",
      );
      await mkdir(resolve(path, ".."), { recursive: true });
      await writeFile(path, canonical(state.current!.manifest) + "\n");
    }
    return "";
  },
}));
vi.mock("@/development/data-sync/tasks", () => ({
  taskProcess: async (task: string) =>
    task === "export"
      ? state.current
      : {
          databaseDigest: state.changed
            ? "f".repeat(64)
            : state.current!.manifest.databaseDigest,
          mapDigest: digest(null),
        },
}));
vi.mock("@/development/data-sync/files", async (original) => ({
  ...(await original<typeof import("@/development/data-sync/files")>()),
  atomicJson: async (path: string, value: unknown) => {
    state.writes.push({ path, value });
  },
}));
beforeEach(async () => {
  const parent = resolve(".medota2/data-sync/unit-fixtures");
  await mkdir(parent, { recursive: true });
  state.root = await mkdtemp(resolve(parent, "publication-"));
  const inventory = tables.map((table) => ({
    name: table.name,
    rows: 0,
    chunks: [],
  }));
  const manifest: SnapshotManifest = {
    version: 1,
    exporter: "medota2-snapshot/1",
    codeCommit: "a".repeat(40),
    exportedAt: new Date().toISOString(),
    parents: [],
    schemaDigest,
    migrationsDigest: await migrationDigest(),
    environment: "local-review",
    databaseDigest: digest(inventory),
    tables: inventory,
    objects: [],
    sources: [],
    map: null,
    heads: {},
  };
  state.current = {
    root: resolve(state.root, "export"),
    snapshotId: snapshotId(manifest),
    manifestSha256: sha256(canonical(manifest) + "\n"),
    manifest,
  };
  state.previous = {
    version: 1,
    repository: "medota2-development-data",
    commit: "b".repeat(40),
    snapshotId: "e".repeat(64),
    manifestSha256: "d".repeat(64),
    schemaDigest,
    migrationsDigest: manifest.migrationsDigest,
  };
  state.changed = false;
  state.writes = [];
  state.fetchSnapshot
    .mockReset()
    .mockResolvedValue({ transfer: { missingObjects: 0 } });
  vi.stubEnv("GH_TOKEN", "fixture-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ private: true }) })),
  );
});
afterEach(async () => {
  await rm(state.root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("reuses an unchanged remote snapshot and requests a separate empty verification store for a full audit", async () => {
  state.previous = {
    ...(state.previous as object),
    snapshotId: state.current!.snapshotId,
  };
  expect((await publishData()).changed).toBe(false);
  expect(state.writes).toEqual([]);
  state.fetchSnapshot.mockClear();
  await publishData({ fullVerification: true });
  const options = state.fetchSnapshot.mock.calls[0][1];
  expect(options.isolatedLfs).toBe(true);
  expect(options.root).toContain(
    `${resolve(state.root, "remote-verification")}`,
  );
  expect(
    state.writes.some((write) => write.path === resolve("dev-data.lock.json")),
  ).toBe(true);
});

it("verifies new content in the persistent remote-only store and preserves the lock if local data changes during publication", async () => {
  await publishData();
  expect(state.fetchSnapshot.mock.calls[0][1]).toEqual({
    root: resolve(state.root, "verified-remote"),
    isolatedLfs: true,
  });
  expect(
    state.writes.find((write) => write.path === resolve("dev-data.lock.json"))
      ?.value,
  ).toMatchObject({
    snapshotId: state.current!.snapshotId,
    commit: "c".repeat(40),
  });
  state.changed = true;
  state.writes = [];
  await expect(publishData()).rejects.toThrow(
    "Local data changed during publication",
  );
  expect(state.writes).toEqual([]);
  await expect(readFile(resolve(state.root, "bundle"))).rejects.toThrow();
});
