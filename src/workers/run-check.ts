import { execFile } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { nativeCommand } from "@/development/command";
import {
  changedFiles,
  createPlan,
  parseArguments,
  type CheckTask,
} from "../../scripts/development/check-plan.mjs";
import {
  acquireLock,
  fingerprint,
  readJson,
  run,
  writeJson,
} from "@/development/runtime";

const exec = promisify(execFile);
const options = parseArguments(process.argv.slice(2));
let interrupted = false;
process.once("SIGINT", () => {
  interrupted = true;
});
process.once("SIGTERM", () => {
  interrupted = true;
});

async function taskKey(task: CheckTask): Promise<string> {
  const pnpm = nativeCommand("pnpm", ["--version"], process.env);
  const versions = await Promise.all([
    exec(pnpm.command, pnpm.args, { windowsHide: true }),
    exec("git", ["config", "--get", "core.autocrlf"]).catch(() => ({
      stdout: "unset",
    })),
  ]);
  // Keep local, CI, OS, architecture and relevant runtime configuration distinct.
  // Only store a digest of environment values; credentials never enter manifests.
  const environment = Object.entries(process.env)
    .filter(([key]) => /^(CI$|NODE_|MEDOTA2_|NEXT_|LANG$|TZ$)/.test(key))
    .sort();
  return createHash("sha256")
    .update(
      JSON.stringify({
        task,
        input: await fingerprint(task.inputs),
        node: process.version,
        pnpm: versions[0].stdout.trim(),
        newline: versions[1].stdout.trim(),
        platform: process.platform,
        architecture: process.arch,
        environment,
      }),
    )
    .digest("hex");
}

async function check(): Promise<boolean> {
  let plan = createPlan(options.files ?? changedFiles(options.base));
  if (options.plan || options.json) {
    console.log(JSON.stringify(plan, null, 2));
    return true;
  }
  // Static tasks only read shared inputs and write independent/atomic evidence.
  // TypeScript already holds its own `types` lock for the incremental cache.
  const shared = plan.tasks.some((task) => task.kind !== "static");
  const release = shared ? await acquireLock("checks") : async () => {};
  if (shared) plan = createPlan(options.files ?? changedFiles(options.base));
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const evidence = resolve(".medota2/checks", runId, "run.json");
  const manifest = {
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    status: "running",
    paths: plan.paths,
    tasks: [] as Array<{
      id: string;
      reason: string;
      status: string;
      key: string;
      durationMs: number;
      command: string;
      args: string[];
    }>,
  };
  let stale = false;
  try {
    console.log(plan.summary);
    await writeJson(evidence, manifest);
    for (const task of plan.tasks) {
      if (interrupted) throw new Error("Check interrupted.");
      const key = await taskKey(task);
      const cachePath = resolve(".medota2/check-cache", `${key}.json`);
      const cached = options.force
        ? null
        : await readJson<{ status: string }>(cachePath);
      const entry = {
        id: task.id,
        reason: task.reason,
        status: "running",
        key,
        durationMs: 0,
        command: task.command,
        args: task.args,
      };
      manifest.tasks.push(entry);
      const started = Date.now();
      // Live browser/database state is verified on every invocation. Static
      // evidence can be reused; release manages its own artifact identity.
      const reusable = task.kind === "static";
      if (reusable && cached?.status === "passed") {
        entry.status = "reused";
        console.log(`[reuse] ${task.id}: ${task.reason}`);
      } else {
        console.log(`[run] ${task.id}: ${task.reason}`);
        try {
          await run(
            task.command,
            task.args,
            process.env,
            resolve(dirname(evidence), `${task.id}.log`),
          );
        } catch (error) {
          entry.status = "failed";
          throw error;
        } finally {
          entry.durationMs = Date.now() - started;
        }
        if ((await taskKey(task)) !== key) {
          entry.status = "stale";
          stale = true;
          console.log(
            `[stale] ${task.id}: 有关输入在检查期间变化，等待稳定后重跑。`,
          );
        } else {
          entry.status = "passed";
          if (reusable)
            await writeJson(cachePath, {
              schemaVersion: 1,
              status: "passed",
              key,
              checkedAt: new Date().toISOString(),
            });
        }
      }
      await writeJson(evidence, manifest);
    }
    // Earlier tasks can also become stale while a later task is running.
    for (const [index, task] of plan.tasks.entries()) {
      if (manifest.tasks[index].key !== (await taskKey(task))) {
        manifest.tasks[index].status = "stale";
        stale = true;
      }
    }
    if (
      JSON.stringify(plan) !==
      JSON.stringify(createPlan(options.files ?? changedFiles(options.base)))
    )
      stale = true;
    manifest.status = stale ? "stale" : "passed";
    console.log(`${manifest.status}: ${evidence}`);
    return !stale;
  } catch (error) {
    manifest.status = interrupted ? "interrupted" : "failed";
    throw error;
  } finally {
    try {
      await writeJson(evidence, {
        ...manifest,
        finishedAt: new Date().toISOString(),
      });
    } finally {
      await release();
    }
  }
}

async function main(): Promise<void> {
  for (;;) {
    const previous = options.watch ? await watchKey() : "";
    let failed = false;
    const passed = await check().catch((error) => {
      if (!options.watch) throw error;
      console.error(error instanceof Error ? error.message : error);
      failed = true;
      return false;
    });
    if (!options.watch || options.plan || options.json || interrupted) {
      if (!passed) process.exitCode = 2;
      return;
    }
    while (
      !interrupted &&
      (passed || failed) &&
      previous === (await watchKey())
    )
      await delay(750);
    if (interrupted) return;
    await delay(350);
  }
}
async function watchKey(): Promise<string> {
  const plan = createPlan(options.files ?? changedFiles(options.base));
  return fingerprint([
    ...plan.paths,
    ...plan.tasks.flatMap((task) => task.inputs),
  ]);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
