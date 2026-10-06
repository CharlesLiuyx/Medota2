import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  digest,
  hasUnexportedChanges,
  canonical,
  snapshotId,
  type SnapshotManifest,
} from "@/development/data-sync/protocol";
import { schemaDigest, tables } from "@/development/data-sync/schema";
import { migrationDigest } from "@/development/data-sync/database";
import {
  manifestPath,
  readSnapshot,
  verifySnapshotFiles,
} from "@/development/data-sync/snapshot";
import { putFile, chunkPath } from "@/development/data-sync/files";
import { developmentRequestAllowed } from "@/development/request";
import { assertSnapshotWritable } from "@/server/environment/snapshot-write-guard";

const state = vi.hoisted(() => ({
  active: null as unknown,
  journal: null as unknown,
}));
vi.mock("@/config/data-sync-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/data-sync-state")>()),
  getWorkbenchPort: () => 3000,
  readActiveSnapshot: () => state.active,
  readSyncJson: () => state.journal,
}));
let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
  state.active = null;
  state.journal = null;
  vi.unstubAllEnvs();
});
async function emptySnapshot() {
  root = await mkdtemp(resolve(tmpdir(), "medota2-snapshot-test-"));
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
    environment: "development",
    databaseDigest: digest(inventory),
    tables: inventory,
    objects: [],
    sources: [],
    map: null,
    heads: {},
  };
  const id = snapshotId(manifest);
  await putFile(manifestPath(root, id), canonical(manifest) + "\n");
  return { manifest, id };
}
describe("development snapshot handoff", () => {
  it("accepts a complete empty snapshot and rejects incompatible schema or modified manifest", async () => {
    const { manifest, id } = await emptySnapshot();
    const saved = await readSnapshot(root!, id);
    await expect(verifySnapshotFiles(root!, saved.manifest)).resolves.toEqual({
      bytes: 0,
      rows: 0,
    });
    const incompatible = { ...manifest, schemaDigest: "f".repeat(64) };
    const other = snapshotId(incompatible);
    await putFile(manifestPath(root!, other), canonical(incompatible) + "\n");
    await expect(readSnapshot(root!, other)).rejects.toThrow(
      "schema/migrations",
    );
    await writeFile(
      manifestPath(root!, id),
      canonical({ ...manifest, exportedAt: "2020-01-01T00:00:00.000Z" }),
    );
    await expect(readSnapshot(root!, id, saved.manifestSha256)).rejects.toThrow(
      "checksum",
    );
  });
  it("rejects missing or corrupted payload before any database restore", async () => {
    const { manifest } = await emptySnapshot();
    manifest.tables[0].chunks = [{ sha256: "b".repeat(64), bytes: 2 }];
    await expect(verifySnapshotFiles(root!, manifest)).rejects.toThrow();
    await putFile(chunkPath(root!, "b".repeat(64)), "{}\n");
    await expect(verifySnapshotFiles(root!, manifest)).rejects.toThrow();
  });
  it("preserves unexported edits and deletions while allowing a saved or matching target", () => {
    const base = {
      current: "edited",
      target: "remote",
      baseline: "original",
      exported: null,
      nonempty: true,
    };
    expect(hasUnexportedChanges(base)).toBe(true);
    expect(hasUnexportedChanges({ ...base, nonempty: false })).toBe(true);
    expect(hasUnexportedChanges({ ...base, exported: "edited" })).toBe(false);
    expect(hasUnexportedChanges({ ...base, target: "edited" })).toBe(false);
    expect(hasUnexportedChanges({ ...base, current: null })).toBe(false);
    expect(
      hasUnexportedChanges({ ...base, baseline: null, nonempty: false }),
    ).toBe(false);
  });
  it("requires an exact loopback host and same-origin browser requests", () => {
    expect(
      developmentRequestAllowed(new Headers({ host: "127.0.0.1:3000" })),
    ).toBe(true);
    const rejected: Record<string, string>[] = [
      { host: "evil.test:3000" },
      { host: "127.0.0.1:3000", origin: "https://evil.test" },
      { host: "localhost:3000", "sec-fetch-site": "cross-site" },
    ];
    for (const headers of rejected)
      expect(developmentRequestAllowed(new Headers(headers))).toBe(false);
    vi.stubEnv("MEDOTA2_WORKBENCH_BROWSER_ORIGIN", "http://localhost:4300");
    expect(
      developmentRequestAllowed(
        new Headers({
          host: "localhost:4300",
          origin: "http://localhost:4300",
        }),
      ),
    ).toBe(true);
  });
  it("blocks writer handles during cutover and after the active database changes", () => {
    const old = resolve(".medota2/environments/local-review");
    expect(() =>
      assertSnapshotWritable(old, "local-review", "import"),
    ).not.toThrow();
    state.journal = {
      phase: "switching",
      next: { lease: { environment: "local-review", stateDirectory: "/new" } },
    };
    expect(() => assertSnapshotWritable(old, "local-review", "import")).toThrow(
      "cutover",
    );
    state.journal = null;
    state.active = {
      lease: { environment: "local-review", stateDirectory: "/new" },
    };
    expect(() => assertSnapshotWritable(old, "local-review", "import")).toThrow(
      "selection changed",
    );
    expect(() =>
      assertSnapshotWritable(old, "local-review", "read"),
    ).not.toThrow();
    expect(() => assertSnapshotWritable(old, "test", "fixture")).not.toThrow();
  });
});
