import { execFile } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { checkStages } from "@/development/check-scheduling";
import { withBrowserBatch } from "@/development/browser-batch";
import { prepareBrowserShards } from "@/development/browser-shards";
import { nativeCommand, normalizeNodePath } from "@/development/command";
import {
  changedFiles,
  createPlan,
  publicationPlan,
  executionPlan,
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

import {
  retryPlan,
  validateFailedCheck,
  type FailedCheck,
  type FailedCase,
} from "@/development/check-retry";

const exec = promisify(execFile);
let retryReceipt: FailedCheck | undefined;
const options = parseArguments(process.argv.slice(2));
function selectedPlan() {
  const plan = createPlan(
    retryReceipt?.paths ?? options.files ?? changedFiles(options.base),
  );
  if (retryReceipt)
    return retryPlan(plan, retryReceipt, Boolean(process.env.CI));
  return executionPlan(
    options.publication ? publicationPlan(plan, Boolean(process.env.CI)) : plan,
    options,
  );
}
let interrupted = false;
let persistInterruption: (() => void) | undefined;
const cancellation = new AbortController();
process.once("SIGINT", () => {
  interrupted = true;
  persistInterruption?.();
  cancellation.abort(new Error("Check interrupted."));
});
process.once("SIGTERM", () => {
  interrupted = true;
  persistInterruption?.();
  cancellation.abort(new Error("Check interrupted."));
});

let pnpmVersion: Promise<{ stdout: string }> | undefined;
async function taskKey(task: CheckTask): Promise<string> {
  const pnpm = nativeCommand("pnpm", ["--version"], process.env);
  // Tool versions are fixed for this process; source/config content is still
  // re-hashed before every batch and at completion.
  pnpmVersion ??= exec(pnpm.command, pnpm.args, { windowsHide: true });
  const versions = await Promise.all([
    pnpmVersion,
    exec("git", ["config", "--get", "core.autocrlf"]).catch(() => ({
      stdout: "unset",
    })),
  ]);
  // Keep local, CI, OS, architecture and relevant runtime configuration distinct.
  // Only store a digest of environment values; credentials never enter manifests.
  const environment = Object.entries(process.env)
    .filter(([key]) => /^(CI$|NODE_|MEDOTA2_|NEXT_|LANG$|TZ$)/.test(key))
    .map(([key, value]) => [
      key,
      key === "NODE_PATH" ? normalizeNodePath(value) : value,
    ])
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
  let plan = selectedPlan();
  if (options.plan || options.json) {
    console.log(JSON.stringify(plan, null, 2));
    return true;
  }
  // Static tasks only read shared inputs and write independent/atomic evidence.
  // TypeScript already holds its own `types` lock for the incremental cache.
  const shared = plan.tasks.some((task) => task.kind !== "static");
  const release = shared
    ? await acquireLock("checks", undefined, cancellation.signal)
    : async () => {};
  if (shared) plan = selectedPlan();
  const runId = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const evidence = resolve(".medota2/checks", runId, "run.json");
  const manifest = {
    schemaVersion: 1,
    runId,
    startedAt: new Date().toISOString(),
    status: "running",
    interruptedAt: undefined as string | undefined,
    error: undefined as string | undefined,
    purpose: retryReceipt ? "failure-diagnosis" : "verification",
    retryOf: options.retryFailed,
    paths: plan.paths,
    tasks: [] as Array<{
      id: string;
      reason: string;
      status: string;
      key: string;
      durationMs: number;
      startedAt: string;
      command: string;
      args: string[];
      error?: string;
      failedCases?: FailedCase[];
    }>,
  };
  // Check receipts are small. One synchronous atomic writer prevents an older
  // in-flight async rename from overwriting the signal handler's checkpoint.
  const save = (
    value: typeof manifest & { finishedAt?: string } = manifest,
  ) => {
    mkdirSync(dirname(evidence), { recursive: true });
    const temporary = `${evidence}.${process.pid}.checkpoint.tmp`;
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
    });
    renameSync(temporary, evidence);
  };
  // "cancelling" means shutdown was requested, not that cleanup was confirmed.
  persistInterruption = () => {
    manifest.status = "interrupted";
    manifest.interruptedAt = new Date().toISOString();
    for (const entry of manifest.tasks) {
      if (entry.status !== "running") continue;
      entry.status = "cancelling";
      entry.durationMs = Date.now() - Date.parse(entry.startedAt);
    }
    try {
      save();
    } catch (error) {
      console.error("Could not persist interrupted check receipt:", error);
    }
  };
  let stale = false;
  const validateCompleted = async () => {
    for (const entry of manifest.tasks) {
      const task = plan.tasks.find((task) => task.id === entry.id)!;
      if (entry.key !== (await taskKey(task))) {
        entry.status = "stale";
        stale = true;
      }
    }
    if (JSON.stringify(plan) !== JSON.stringify(selectedPlan())) stale = true;
  };
  const executeTask = async (
    task: CheckTask,
    signal: AbortSignal,
    environment = process.env,
    commandArgs = task.args,
    belowNormal = false,
  ) => {
    signal.throwIfAborted();
    const key = await taskKey(task);
    const cachePath = resolve(".medota2/check-cache", `${key}.json`);
    const cached = options.force
      ? null
      : await readJson<{ status: string }>(cachePath);
    const entry: (typeof manifest.tasks)[number] = {
      id: task.id,
      reason: task.reason,
      status: "running",
      key,
      durationMs: 0,
      startedAt: new Date().toISOString(),
      command: task.command,
      args: commandArgs,
    };
    manifest.tasks.push(entry);
    await save();
    const started = Date.now();
    // Live browser/database state is verified on every invocation. Static
    // evidence can be reused; release manages its own artifact identity.
    const reusable = task.kind === "static";
    if (reusable && !retryReceipt && cached?.status === "passed") {
      entry.status = "reused";
      console.log(`[reuse] ${task.id}: ${task.reason}`);
    } else {
      console.log(`[run] ${task.id}: ${task.reason}`);
      try {
        await run(
          task.command,
          commandArgs,
          task.kind === "browser"
            ? {
                ...environment,
                ...(environment.MEDOTA2_FIXTURE_BROWSER_BATCH === "1"
                  ? {
                      MEDOTA2_ARTIFACT_ROOT: resolve(
                        environment.MEDOTA2_ARTIFACT_ROOT!,
                        task.id,
                      ),
                    }
                  : {}),
                MEDOTA2_CHECK_FAILURE_FILE: resolve(
                  dirname(evidence),
                  `${task.id}.failures.json`,
                ),
              }
            : process.env,
          resolve(dirname(evidence), `${task.id}.log`),
          signal,
          belowNormal,
        );
      } catch (error) {
        entry.status = signal.aborted ? "cancelled" : "failed";
        entry.error = error instanceof Error ? error.message : String(error);
        entry.failedCases =
          (await readJson<FailedCase[]>(
            resolve(dirname(evidence), `${task.id}.failures.json`),
          )) ?? undefined;
        console.error(
          `[retry] pnpm check --retry-failed ${JSON.stringify(evidence)}`,
        );
        console.error(
          `[evidence] ${resolve(dirname(evidence), `${task.id}.log`)}`,
        );
        throw error;
      } finally {
        entry.durationMs = Date.now() - started;
        await save();
      }
      if ((await taskKey(task)) !== key) {
        entry.status = "stale";
        stale = true;
        console.log(
          `[stale] ${task.id}: 有关输入在检查期间变化，等待稳定后重跑。`,
        );
        throw new Error(
          "Check inputs changed; stop and replan before further checks.",
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
    await save();
  };
  try {
    console.log(plan.summary);
    await save();
    if (options.lane === "browser" && plan.tasks.length) {
      await withBrowserBatch(async (env, signal) => {
        const commands = options.shard
          ? await prepareBrowserShards(
              plan.tasks,
              options.shard,
              env,
              dirname(evidence),
              signal,
            )
          : undefined;
        for (const task of plan.tasks) {
          await validateCompleted();
          if (stale)
            throw new Error("Check inputs changed during browser batch.");
          await executeTask(task, signal, env, commands?.get(task.id));
        }
        // Validate while the fixture lease is held, before its passing receipt.
        await validateCompleted();
        if (stale)
          throw new Error("Check inputs changed during browser batch.");
      }, cancellation.signal);
    } else {
      const stages = checkStages(
        plan.tasks,
        !process.env.CI && !options.publication && !retryReceipt,
      );
      for (const chains of stages) {
        cancellation.signal.throwIfAborted();
        await validateCompleted();
        if (stale)
          throw new Error(
            "Check inputs changed; stop and replan before further checks.",
          );
        const group = new AbortController();
        const signal = AbortSignal.any([cancellation.signal, group.signal]);
        let failure: unknown;
        const outcomes = await Promise.allSettled(
          chains.map(async (chain) => {
            try {
              for (const task of chain) {
                signal.throwIfAborted();
                await validateCompleted();
                if (stale)
                  throw new Error("Check inputs changed during a task chain.");
                signal.throwIfAborted();
                await executeTask(
                  task,
                  signal,
                  process.env,
                  task.args,
                  chains.length > 1 && task.kind === "build",
                );
              }
            } catch (error) {
              if (!group.signal.aborted) {
                failure = error;
                group.abort(error);
              }
              throw error;
            }
          }),
        );
        if (group.signal.aborted) throw failure;
        for (const outcome of outcomes)
          if (outcome.status === "rejected") throw outcome.reason;
      }
    }
    await validateCompleted();
    manifest.status = stale ? "stale" : "passed";
    console.log(`${manifest.status}: ${evidence}`);
    return !stale;
  } catch (error) {
    manifest.status = stale ? "stale" : interrupted ? "interrupted" : "failed";
    manifest.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    try {
      save({
        ...manifest,
        finishedAt: new Date().toISOString(),
      });
    } finally {
      persistInterruption = undefined;
      await release();
    }
  }
}

async function main(): Promise<void> {
  if (options.retryFailed)
    retryReceipt = validateFailedCheck(await readJson(options.retryFailed));
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
  const plan = selectedPlan();
  return fingerprint([
    ...plan.paths,
    ...plan.tasks.flatMap((task) => task.inputs),
  ]);
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
