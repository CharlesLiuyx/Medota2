import { mkdtemp, readFile, rm } from "node:fs/promises";
import { constants, getPriority, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { run, acquireLock } from "@/development/runtime";
import { checkStages } from "@/development/check-scheduling";
import { createPlan } from "../../scripts/development/check-plan.mjs";

describe("owned command cancellation", () => {
  it("lowers only the owned child priority and passes it to descendants", async () => {
    const root = await mkdtemp(join(tmpdir(), "medota-priority-"));
    const output = join(root, "priority.json");
    const original = getPriority();
    const grandchild = "console.log(require('node:os').getPriority())";
    const script = `const os = require('node:os'); const value = require('node:child_process').execFileSync(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {encoding:'utf8'}); require('node:fs').writeFileSync(${JSON.stringify(output)}, JSON.stringify([os.getPriority(), Number(value)]));`;
    try {
      await run(
        process.execPath,
        ["-e", script],
        process.env,
        undefined,
        undefined,
        true,
      );
      const priorities = JSON.parse(await readFile(output, "utf8"));
      expect(priorities).toHaveLength(2);
      for (const priority of priorities)
        expect(priority).toBeGreaterThanOrEqual(
          constants.priority.PRIORITY_BELOW_NORMAL,
        );
      expect(getPriority()).toBe(original);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
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
  it("overlaps real journeys with an ordered fixture chain and preserves all selected tasks", () => {
    const plan = createPlan(["src/workers/run-check.ts"]);
    const batches = checkStages(plan.tasks, true);
    expect(
      batches
        .flat(2)
        .map((task) => task.id)
        .sort(),
    ).toEqual(plan.tasks.map((task) => task.id).sort());
    expect(
      batches
        .filter((batch) => batch.length > 1)
        .map((batch) => batch.map((chain) => chain.map((task) => task.id))),
    ).toEqual([[["journeys"], ["build", "e2e", "database-contract"]]]);
    expect(
      checkStages(plan.tasks, false).every((batch) => batch.length === 1),
    ).toBe(true);
  });
});
