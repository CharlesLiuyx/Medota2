import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { finished } from "node:stream/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildStoragePlan,
  executeStoragePlan,
  defaultStoragePolicy,
} from "@/development/storage";
import { RotatingLog } from "@/development/rotating-log";

const roots: string[] = [];
const now = Date.parse("2026-10-06T10:00:00Z");
const day = 86400000;
async function workspace(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "medota2-storage-"));
  roots.push(root);
  return root;
}
async function file(
  root: string,
  path: string,
  data = "artifact",
): Promise<void> {
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(resolve(root, path), data);
}
async function json(root: string, path: string, data: unknown): Promise<void> {
  await file(root, path, JSON.stringify(data));
}
function release(id: number): string {
  return `.medota2/releases/${id.toString(16).padStart(64, "0")}`;
}
function run(id: number): string {
  return `.medota2/shared-tests/runs/${1790000000000 + id}-aaaaaaaa`;
}
async function testRun(
  root: string,
  id: number,
  status: string,
  time: number,
  pid: number | undefined = 1,
): Promise<string> {
  const path = run(id);
  await json(root, `${path}/run.json`, {
    status,
    pid,
    ...(status === "running"
      ? {}
      : { finishedAt: new Date(time).toISOString() }),
  });
  await file(root, `${path}/report/index.html`);
  await file(root, `${path}/test-results/result.txt`);
  return path;
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("storage retention flows", () => {
  it("previews then trims releases while preserving pinned and active builds and link destinations", async () => {
    const root = await workspace(),
      external = await workspace();
    for (let id = 1; id <= 5; id++) {
      await json(root, `${release(id)}/manifest.json`, {
        status: "passed",
        key: release(id).split("/").at(-1),
        builtAt: new Date(now - (6 - id) * day).toISOString(),
      });
      await file(root, `${release(id)}/app/server.js`);
    }
    await file(root, `${release(1)}/.keep`);
    await json(root, `${release(6)}/manifest.json`, {
      status: "running",
      pid: process.pid,
    });
    await file(external, "sentinel", "outside");
    await symlink(
      external,
      resolve(root, `${release(2)}/app/dependency`),
      process.platform === "win32" ? "junction" : "dir",
    );
    await file(
      root,
      ".medota2/data-sync/candidates/identity",
      "private identity",
    );
    const plan = await buildStoragePlan({ root, now, scope: "releases" });
    expect(plan.actions.map((entry) => entry.path).sort()).toEqual([
      release(2),
      release(3),
    ]);
    expect(
      await readFile(resolve(root, `${release(2)}/app/server.js`), "utf8"),
    ).toBe("artifact");
    await executeStoragePlan(plan, root);
    expect(await readdir(resolve(root, ".medota2/releases"))).toHaveLength(4);
    expect(await readFile(resolve(external, "sentinel"), "utf8")).toBe(
      "outside",
    );
    expect(
      await readFile(
        resolve(root, ".medota2/data-sync/candidates/identity"),
        "utf8",
      ),
    ).toBe("private identity");
  });
  it("keeps recent results, running tasks, unresolved legacy failures and leased state while trimming only attachments", async () => {
    const root = await workspace();
    for (let id = 1; id <= 12; id++)
      await testRun(root, id, "passed", now - (20 - id) * day);
    await file(root, `${run(1)}/.keep`);
    for (let id = 20; id <= 25; id++)
      await testRun(root, id, "failed", now - (40 - id) * day);
    await testRun(root, 30, "failed", now - day);
    await testRun(root, 31, "failed", now - 50 * day, undefined);
    // Legacy records deliberately lack PID metadata.
    await json(root, `${run(31)}/run.json`, {
      status: "failed",
      finishedAt: new Date(now - 50 * day).toISOString(),
    });
    await testRun(root, 32, "running", now, process.pid);
    const leased = ".medota2/test-runs/integration-20261005t184425z-aaaaaaaa";
    await json(root, ".medota2/shared-tests/environment.json", {
      context: { runRoot: resolve(root, leased) },
    });
    await json(root, `${leased}/run.json`, {
      status: "passed",
      finishedAt: new Date(now - 50 * day).toISOString(),
      cleanup: { status: "cleaned", databaseRetained: false },
    });
    await file(root, `${leased}/next/cache`, "leased cache");
    const plan = await buildStoragePlan({ root, now, scope: "tests" });
    expect(
      plan.actions.some((entry) => entry.path.startsWith(`${run(2)}/`)),
    ).toBe(true);
    expect(
      plan.actions.some((entry) => entry.path.startsWith(`${run(20)}/`)),
    ).toBe(true);
    for (const path of [
      run(1),
      run(12),
      run(25),
      run(30),
      run(31),
      run(32),
      leased,
    ])
      expect(
        plan.actions.some((entry) => entry.path.startsWith(`${path}/`)),
      ).toBe(false);
    await executeStoragePlan(plan, root);
    expect(
      JSON.parse(await readFile(resolve(root, `${run(2)}/run.json`), "utf8"))
        .status,
    ).toBe("passed");
    expect(await readFile(resolve(root, `${leased}/next/cache`), "utf8")).toBe(
      "leased cache",
    );
    expect(await readdir(resolve(root, run(2)))).toEqual([
      "run.json",
      "storage-cleanup.json",
    ]);
  });
  it("deduplicates matching trace content and refuses deletion when the report copy changes", async () => {
    const root = await workspace();
    await testRun(root, 1, "passed", now);
    const original = `${run(1)}/test-results/journey/trace.zip`,
      retained = `${run(1)}/report/data/trace.zip`;
    await file(root, original, "trace content");
    await file(root, retained, "trace content");
    await file(
      root,
      `${run(1)}/test-results/journey/different.zip`,
      "other content",
    );
    const plan = await buildStoragePlan({ root, scope: "tests", now });
    expect(plan.actions.map((entry) => entry.path)).toEqual([original]);
    await file(root, retained, "changed bytes");
    await expect(executeStoragePlan(plan, root)).rejects.toThrow(
      "Trace changed",
    );
    expect(await readFile(resolve(root, original), "utf8")).toBe(
      "trace content",
    );
    await file(root, retained, "trace content");
    await executeStoragePlan(plan, root);
    expect(await readFile(resolve(root, retained), "utf8")).toBe(
      "trace content",
    );
  });
  it("rejects linked managed roots, newly pinned candidates and malformed policy", async () => {
    const root = await workspace(),
      external = await workspace();
    await mkdir(resolve(external, "releases"));
    await symlink(
      external,
      resolve(root, ".medota2"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(buildStoragePlan({ root })).rejects.toThrow("refuses links");
    await rm(resolve(root, ".medota2"));
    await json(root, ".medota2/storage-policy.json", { releases: 0 });
    await expect(buildStoragePlan({ root })).rejects.toThrow();
    await json(root, ".medota2/storage-policy.json", { successfulTests: 1 });
    await testRun(root, 1, "passed", now - day);
    await testRun(root, 2, "passed", now);
    const plan = await buildStoragePlan({ root, now });
    await file(root, `${run(1)}/.keep`);
    await expect(executeStoragePlan(plan, root)).rejects.toThrow("was pinned");
    await expect(
      executeStoragePlan(
        {
          ...plan,
          actions: [
            {
              path: ".medota2/data-sync/candidates",
              kind: "directory",
              reason: "invalid",
              bytes: 0,
            },
          ],
        },
        root,
      ),
    ).rejects.toThrow("Unsupported cleanup");
  });
  it("rotates continuously, imports an oversized old log and keeps a bounded chronological tail", async () => {
    const root = await workspace(),
      path = ".medota2/development/server.log";
    const initial = "A".repeat(1300),
      incoming = "B".repeat(2800);
    await file(root, path, initial);
    const writer = await RotatingLog.create(root, {
      ...defaultStoragePolicy,
      logMaxBytes: 1024,
      logArchives: 2,
    });
    writer.end(incoming);
    await finished(writer);
    const log = await readFile(resolve(root, path)),
      first = await readFile(resolve(root, `${path}.1`)),
      second = await readFile(resolve(root, `${path}.2`));
    for (const part of [log, first, second])
      expect(part.length).toBeLessThanOrEqual(1024);
    expect(Buffer.concat([second, first, log]).toString()).toBe(
      (initial + incoming).slice(-2052),
    );
    expect(await readdir(resolve(root, ".medota2/development"))).toHaveLength(
      3,
    );
    const next = await RotatingLog.create(root, {
      ...defaultStoragePolicy,
      logMaxBytes: 1024,
      logArchives: 2,
    });
    next.end("C".repeat(1024));
    await finished(next);
    expect((await readFile(resolve(root, path))).toString()).toBe(
      "C".repeat(4),
    );
  });
  it("applies smaller log limits on restart and preserves interrupted imports", async () => {
    const root = await workspace(),
      path = ".medota2/development/server.log";
    await file(root, path, "A".repeat(2048));
    for (let i = 1; i <= 3; i++)
      await file(root, `${path}.${i}`, "B".repeat(2048));
    const writer = await RotatingLog.create(root, {
      ...defaultStoragePolicy,
      logMaxBytes: 1024,
      logArchives: 1,
    });
    writer.end("X");
    await finished(writer);
    expect(await readdir(resolve(root, ".medota2/development"))).toEqual([
      "server.log",
      "server.log.1",
    ]);
    expect((await readFile(resolve(root, `${path}.1`))).length).toBe(1024);
    await file(root, `${path}.import`, "recoverable original");
    await expect(
      RotatingLog.create(root, defaultStoragePolicy),
    ).rejects.toThrow("Interrupted log import");
    expect(await readFile(resolve(root, `${path}.import`), "utf8")).toBe(
      "recoverable original",
    );
    expect(await readFile(resolve(root, path), "utf8")).toBe("X");
  });
});
