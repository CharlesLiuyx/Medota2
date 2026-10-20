import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { changedFiles, createPlan, executionPlan } from "./check-plan.mjs";
const browserTimings = JSON.parse(
  readFileSync(new URL("./browser-durations.json", import.meta.url), "utf8"),
);

export function candidateBase(branch) {
  return /^codex\/publish\/([a-f0-9]{40})\/\d+-[a-f0-9]{8}$/.exec(branch)?.[1];
}

/** Preserve the core task union while giving the fixture build its own host. */
export function coreLanesForPlan(plan) {
  return ["static", "runtime"].filter(
    (lane) => executionPlan(plan, { lane }).tasks.length > 0,
  );
}

/** Fewer hosts for bounded journeys; native discovery still distributes every case. */
export function browserShardsForPlan(plan) {
  const tasks = executionPlan(plan, { lane: "browser" }).tasks;
  if (!tasks.length) return [];
  const task =
    tasks.length === 1 && tasks[0].id === "journeys" ? tasks[0] : undefined;
  const grepIndex = task?.args.indexOf("--grep") ?? -1;
  const pattern =
    grepIndex >= 0 ? new RegExp(task.args[grepIndex + 1]) : undefined;
  const estimates = pattern
    ? Object.entries(browserTimings.durationsMs)
        .filter(([id]) => id.includes(" › tests/journeys/") && pattern.test(id))
        .map(([, duration]) => Number(duration))
    : [];
  if (estimates.some((duration) => !Number.isFinite(duration) || duration < 0))
    throw new Error("Invalid browser duration estimate.");
  // Aim for <=60 seconds of known test work per host, capped at six.
  // This is a capacity estimate, never a test filter: new cases are still
  // discovered and balanced by the native runner. Unknown scopes retain six.
  const count = estimates.length
    ? Math.min(
        6,
        Math.max(1, Math.ceil(estimates.reduce((a, b) => a + b, 0) / 60_000)),
      )
    : 6;
  return Array.from({ length: count }, (_, index) => index + 1);
}

export function benchmarkFile(profile = "auto") {
  const profiles = {
    auto: "",
    full: "src/workers/run-check.ts",
    items: "src/domain/items.ts",
    "hero-build": "src/domain/hero-build.ts",
    map: "src/components/map/map-viewer.tsx",
  };
  if (!Object.hasOwn(profiles, profile))
    throw new Error("Unknown CI benchmark profile.");
  return profiles[profile];
}

export function reusableCandidate(run, { sha, base, workflowId, repository }) {
  return (
    run.head_sha === sha &&
    run.event === "push" &&
    run.status === "completed" &&
    run.conclusion === "success" &&
    run.workflow_id === workflowId &&
    run.head_repository?.full_name === repository &&
    candidateBase(run.head_branch) === base
  );
}

function main() {
  const git = (...args) =>
    execFileSync("git", args, { encoding: "utf8" }).trim();
  const api = (path) =>
    JSON.parse(
      execFileSync("gh", ["api", path], { encoding: "utf8", timeout: 30_000 }),
    );
  const repository = process.env.GITHUB_REPOSITORY;
  const branch = process.env.GITHUB_REF_NAME;
  const isPush = process.env.GITHUB_EVENT_NAME === "push";
  let base = process.env.PR_BASE || process.env.PUSH_BASE;
  if (isPush && branch.startsWith("codex/publish/")) {
    base = candidateBase(branch);
    if (!base) throw new Error("Malformed publication candidate branch.");
    git("merge-base", "--is-ancestor", base, "HEAD");
  }
  if (!base || /^0+$/.test(base)) {
    try {
      base = git("rev-parse", "HEAD^");
    } catch {
      base = git("hash-object", "-t", "tree", "/dev/null");
    }
  }
  let promoted = false;
  if (isPush && branch === "main") {
    const workflow = api(`repos/${repository}/actions/workflows/verify.yml`);
    const { workflow_runs: runs } = api(
      `repos/${repository}/actions/workflows/${workflow.id}/runs?head_sha=${process.env.GITHUB_SHA}&event=push&per_page=100`,
    );
    // Only the newest attempt per candidate branch is admissible. A failed rerun invalidates success.
    const latest = new Map();
    for (const run of runs.sort((a, b) => b.id - a.id))
      if (!latest.has(run.head_branch)) latest.set(run.head_branch, run);
    promoted = [...latest.values()].some((run) =>
      reusableCandidate(run, {
        sha: process.env.GITHUB_SHA,
        base,
        workflowId: workflow.id,
        repository,
      }),
    );
  }
  const file =
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
      ? benchmarkFile(process.env.BENCHMARK_PROFILE || "auto")
      : "";
  const plan = createPlan(file ? [file] : changedFiles(base));
  mkdirSync(".medota2", { recursive: true });
  writeFileSync(
    ".medota2/check-plan.json",
    JSON.stringify({ ...plan, base, promoted }, null, 2),
  );
  const core = executionPlan(plan, { lane: "core" });
  const browser = executionPlan(plan, { lane: "browser" });
  const output = {
    base,
    file,
    promoted,
    core: !promoted && core.tasks.length > 0,
    coreLanes: JSON.stringify(promoted ? [] : coreLanesForPlan(plan)),
    browser: !promoted && browser.browser,
    browserShards: JSON.stringify(promoted ? [] : browserShardsForPlan(plan)),
    browserShardCount: browserShardsForPlan(plan).length,
    coreDatabase: core.database,
  };
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(output)
      .map(([key, value]) => `${key}=${value}\n`)
      .join(""),
  );
  console.log(
    JSON.stringify({ ...output, tasks: plan.tasks.map((task) => task.id) }),
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main();
