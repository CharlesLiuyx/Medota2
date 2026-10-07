import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
const execute = promisify(execFile);
export type CIRun = {
  databaseId: number;
  headSha: string;
  event: string;
  status: string;
  conclusion: string | null;
  url: string;
};
export function githubRepository(url: string): string {
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(
      url,
    );
  if (!match)
    throw new Error(
      "发布CI确认目前支持GitHub仓库；远端地址必须为不含凭据的HTTPS或SSH地址。",
    );
  return match[1];
}
export async function gh(args: string[]): Promise<string> {
  return (
    await execute("gh", args, {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    })
  ).stdout.trim();
}
export function selectCIRun(runs: CIRun[], sha: string): CIRun | undefined {
  return runs
    .filter((run) => run.headSha === sha && run.event === "push")
    .sort((a, b) => b.databaseId - a.databaseId)[0];
}
export async function waitForCI(
  repository: string,
  sha: string,
  options: {
    timeoutMs?: number;
    query?: () => Promise<CIRun[]>;
    sleep?: (ms: number) => Promise<unknown>;
    progress?: (run: CIRun) => Promise<void>;
  } = {},
): Promise<CIRun> {
  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60_000);
  let last = "";
  do {
    const runs: CIRun[] = options.query
      ? await options.query()
      : JSON.parse(
          await gh([
            "run",
            "list",
            "--repo",
            repository,
            "--workflow",
            "verify.yml",
            "--commit",
            sha,
            "--event",
            "push",
            "--limit",
            "10",
            "--json",
            "databaseId,headSha,event,status,conclusion,url",
          ]),
        );
    const run = selectCIRun(runs, sha);
    const state = run
      ? `${run.databaseId}:${run.status}:${run.conclusion}`
      : "waiting-for-run";
    if (state !== last) {
      console.log(`[push] CI: ${state}`);
      if (run) await options.progress?.(run);
      last = state;
    }
    if (run?.status === "completed") {
      if (run.conclusion !== "success")
        throw new Error(
          `CI ${run.conclusion}: ${run.url}。修复后重新发布；仅重新运行CI时使用 pnpm push --resume。`,
        );
      return run;
    }
    if (Date.now() >= deadline) break;
    await (options.sleep ?? delay)(Math.min(15_000, deadline - Date.now()));
  } while (Date.now() < deadline);
  throw new Error(
    "等待CI超时，发布收据已保存。使用 pnpm push --resume 继续确认，不重复发布。",
  );
}
