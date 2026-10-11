import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { run, acquireLock } from "@/development/runtime";
import { checkBatches } from "@/development/check-scheduling";
import { createPlan } from "../../scripts/development/check-plan.mjs";

describe("owned command cancellation", () => {
  it.skipIf(process.platform === "win32")(
    "terminates a grandchild and waits for its shutdown output",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "medota-cancel-"));
      const ready = join(root, "ready");
      const stopped = join(root, "stopped");
      const grandchild = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000); process.on('SIGTERM', () => setTimeout(() => { fs.writeFileSync(${JSON.stringify(stopped)}, 'cleaned'); process.exit(0); }, 50));`;
      const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;
      const controller = new AbortController();
      const result = run(
        process.execPath,
        ["-e", parent],
        process.env,
        join(root, "run.log"),
        controller.signal,
      ).catch((error: unknown) => error);
      try {
        await vi.waitFor(async () =>
          expect(await readFile(ready, "utf8")).toMatch(/^\d+$/),
        );
        controller.abort();
        expect(await result).toBeInstanceOf(Error);
        expect(await readFile(stopped, "utf8")).toBe("cleaned");
      } finally {
        controller.abort();
        await result;
        await rm(root, { recursive: true, force: true });
      }
    },
  );
  it("aborts lock waits without acquiring or removing someone else's lock", async () => {
    const name = `cancel-test-${process.pid}`;
    const release = await acquireLock(name);
    const controller = new AbortController();
    const waiting = acquireLock(name, 10_000, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow();
    await release();
    const next = await acquireLock(name, 0);
    await next();
  });
  it("overlaps only real journeys with the build and preserves all selected tasks", () => {
    const plan = createPlan(["src/workers/run-check.ts"]);
    const batches = checkBatches(plan.tasks, true);
    expect(
      batches
        .flat()
        .map((task) => task.id)
        .sort(),
    ).toEqual(plan.tasks.map((task) => task.id).sort());
    expect(
      batches
        .filter((batch) => batch.length > 1)
        .map((batch) => batch.map((task) => task.id)),
    ).toEqual([["journeys", "build"]]);
    expect(
      checkBatches(plan.tasks, false).every((batch) => batch.length === 1),
    ).toBe(true);
  });
});
