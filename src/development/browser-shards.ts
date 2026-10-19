import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { CheckTask } from "../../scripts/development/check-plan.mjs";
import timings from "../../scripts/development/browser-durations.json";
import { nativeCommand } from "./command";
import { writeJson } from "./runtime";

const execute = promisify(execFile);
export interface BrowserCase {
  id: string;
  taskId: string;
  listEntry: string;
  durationMs: number;
}
interface ListedSuite {
  title: string;
  suites?: ListedSuite[];
  specs?: Array<{
    title: string;
    file: string;
    tests: Array<{ projectName: string }>;
  }>;
}
interface TestList {
  config: { rootDir: string };
  suites: ListedSuite[];
  errors?: unknown[];
}
const posix = (path: string) => path.replaceAll("\\", "/");
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Runtime discovery is authoritative. Timings only influence placement, never selection. */
export function listedCases(
  report: TestList,
  taskId: string,
  weights: Record<string, number> = timings.durationsMs,
  workspace = process.cwd(),
): BrowserCase[] {
  if (report.errors?.length)
    throw new Error("Playwright test discovery failed.");
  const cases: BrowserCase[] = [];
  const visit = (suite: ListedSuite, parents: string[], fileSuite = false) => {
    const titles = fileSuite ? parents : [...parents, suite.title];
    for (const spec of suite.specs ?? []) {
      const file = posix(
        relative(workspace, resolve(report.config.rootDir, spec.file)),
      );
      for (const test of spec.tests) {
        const title = [...titles, spec.title].join(" › ");
        const id = `[${test.projectName}] › ${file} › ${title}`;
        const durationMs = weights[id] ?? timings.unknownEstimateMs;
        if (!Number.isFinite(durationMs) || durationMs < 0)
          throw new Error(`Invalid browser duration: ${id}`);
        cases.push({
          id,
          taskId,
          durationMs,
          listEntry: `[${test.projectName}] › ${posix(spec.file)} › ${title}`,
        });
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  };
  for (const suite of report.suites) visit(suite, [], true);
  return cases;
}

/** Longest cases first, stable tie-breaks. Every discovered identity appears once. */
export function balanceBrowserCases(cases: BrowserCase[], count: number) {
  if (!Number.isInteger(count) || count < 1)
    throw new Error("Invalid shard count.");
  const ids = new Set(cases.map((test) => test.id));
  if (ids.size !== cases.length)
    throw new Error("Duplicate browser test identity.");
  const shards = Array.from({ length: count }, () => ({
    durationMs: 0,
    cases: [] as BrowserCase[],
  }));
  for (const test of [...cases].sort(
    (a, b) => b.durationMs - a.durationMs || compare(a.id, b.id),
  )) {
    const shard = shards.reduce((best, candidate) =>
      candidate.durationMs < best.durationMs ? candidate : best,
    );
    shard.cases.push(test);
    shard.durationMs += test.durationMs;
  }
  return shards;
}

function playwrightArgs(task: CheckTask): string[] {
  const suite = task.args.indexOf("src/workers/run-shared-tests.ts");
  const forwarded =
    suite >= 0 ? task.args.slice(suite + 2) : task.args.slice(1);
  if (suite < 0 && task.args[0] !== "test:e2e")
    throw new Error(`Unsupported browser runner: ${task.id}`);
  if (
    forwarded.some(
      (arg) =>
        /^--(?:test-list|shard)(?:$|=)/.test(arg) &&
        !arg.startsWith("--shard="),
    )
  )
    throw new Error("Conflicting browser selection arguments.");
  return forwarded.filter(
    (arg) =>
      arg !== "--fixture" &&
      !arg.startsWith("--warm-scopes=") &&
      !arg.startsWith("--shard="),
  );
}

/** Prepare exact native --test-list selections inside the existing fixture lease.
 * Re-list each selection to prove Playwright interprets it as the intended set. */
export async function prepareBrowserShards(
  tasks: CheckTask[],
  shard: string,
  env: NodeJS.ProcessEnv,
  evidenceRoot: string,
  signal: AbortSignal,
): Promise<Map<string, string[]>> {
  if (!/^[1-9]\d*\/[1-9]\d*$/.test(shard)) throw new Error("Invalid shard.");
  const [index, count] = shard.split("/").map(Number);
  if (index > count) throw new Error("Invalid shard index.");
  const list = async (task: CheckTask, extra: string[] = []) => {
    signal.throwIfAborted();
    const config =
      task.id === "journeys"
        ? "playwright.shared.config.ts"
        : "playwright.config.ts";
    const invocation = nativeCommand(
      "pnpm",
      [
        "exec",
        "playwright",
        "test",
        "--config",
        config,
        ...playwrightArgs(task),
        ...extra,
        "--list",
        "--reporter=json",
      ],
      env,
    );
    const result = await execute(invocation.command, invocation.args, {
      env,
      signal,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return listedCases(JSON.parse(result.stdout), task.id);
  };
  const cases: BrowserCase[] = [];
  for (const task of tasks) cases.push(...(await list(task)));
  if (!cases.length)
    throw new Error("Selected browser plan contains no tests.");
  const balanced = balanceBrowserCases(cases, count);
  const selection = balanced[index - 1].cases;
  const commands = new Map<string, string[]>();
  for (const task of tasks) {
    const selected = selection.filter((test) => test.taskId === task.id);
    const path = resolve(evidenceRoot, `${task.id}.test-list.txt`);
    await writeFile(
      path,
      selected.map((test) => test.listEntry).join("\n") + "\n",
    );
    // Empty slices are valid for narrow scopes, but empty discovery is not.
    // Re-list even an empty selection to prove the native filter selects none.
    const selectionArgs = [
      `--test-list=${path}`,
      ...(selected.length ? [] : ["--pass-with-no-tests"]),
    ];
    const actual = await list(task, selectionArgs);
    if (
      JSON.stringify(actual.map((test) => test.id).sort(compare)) !==
      JSON.stringify(selected.map((test) => test.id).sort(compare))
    )
      throw new Error(
        `Browser shard selection differs from discovered cases: ${task.id}`,
      );
    commands.set(task.id, [
      ...task.args.filter((arg) => !arg.startsWith("--shard=")),
      ...selectionArgs,
    ]);
  }
  await writeJson(resolve(evidenceRoot, "browser-shards.json"), {
    schemaVersion: 1,
    shard,
    source: timings.source,
    timingsHash: createHash("sha256")
      .update(JSON.stringify(timings))
      .digest("hex"),
    selectionHash: createHash("sha256")
      .update(JSON.stringify(cases.map((test) => test.id).sort(compare)))
      .digest("hex"),
    totalCases: cases.length,
    shards: balanced.map((part, i) => ({
      index: i + 1,
      estimatedMs: part.durationMs,
      cases: part.cases.map((test) => test.id),
    })),
  });
  console.log(
    `[shard] ${shard}: ${selection.length}/${cases.length} cases; estimated ${(balanced[index - 1].durationMs / 1000).toFixed(1)}s`,
  );
  return commands;
}
