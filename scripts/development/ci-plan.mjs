import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { changedFiles, createPlan, executionPlan } from "./check-plan.mjs";

export function candidateBase(branch) {
  return /^codex\/publish\/([a-f0-9]{40})\/\d+-[a-f0-9]{8}$/.exec(branch)?.[1];
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

// Each selected browser task gets its own hosts, so suites do not repeatedly
// boot and warm separate servers in series on the critical path.
export function browserMatrix(plan) {
  const counts = { journeys: 8, e2e: 2, visual: 2 };
  return {
    include: plan.tasks
      .filter((task) => task.kind === "browser")
      .flatMap((task) => {
        const total = counts[task.id];
        if (!total)
          throw new Error(`Missing CI partition for browser task ${task.id}.`);
        return Array.from({ length: total }, (_, index) => ({
          task: task.id,
          shard: `${index + 1}/${total}`,
          index: index + 1,
        }));
      }),
  };
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
  const plan = createPlan(changedFiles(base));
  mkdirSync(".medota2", { recursive: true });
  writeFileSync(
    ".medota2/check-plan.json",
    JSON.stringify({ ...plan, base, promoted }, null, 2),
  );
  const core = executionPlan(plan, { lane: "core" });
  const browser = executionPlan(plan, { lane: "browser" });
  const output = {
    base,
    promoted,
    core: !promoted && core.tasks.length > 0,
    browser: !promoted && browser.browser,
    coreDatabase: core.database,
    browserMatrix: JSON.stringify(browserMatrix(plan)),
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
