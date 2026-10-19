import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
const execute = promisify(execFile);
export type CIRun = {
  databaseId: number;
  headSha: string;
  headBranch?: string;
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

/** Retry transport failures for read-only evidence queries. TLS verification and
 * exact candidate checks remain mandatory; writes and CI failures never enter here. */
export async function retryCIRead<T>(
  read: () => Promise<T>,
  options: {
    signal?: AbortSignal;
    sleep?: (ms: number) => Promise<unknown>;
  } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try {
      return await read();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        attempt >= 2 ||
        !/tls:|TLS handshake timeout|x509:|ECONNRESET|ETIMEDOUT|connection reset|connection refused|network is unreachable|i\/o timeout|HTTP 50[234]/i.test(
          message,
        )
      )
        throw error;
      console.error(
        `[push] CI只读查询连接失败，${attempt + 1}/2次重试；保持原证书及候选校验。`,
      );
      if (options.sleep) await options.sleep(1000 * (attempt + 1));
      else
        await delay(1000 * (attempt + 1), undefined, {
          signal: options.signal,
        });
    }
  }
}
export function selectCIRun(
  runs: CIRun[],
  sha: string,
  branch?: string,
): CIRun | undefined {
  return runs
    .filter(
      (run) =>
        run.headSha === sha &&
        run.event === "push" &&
        (!branch || run.headBranch === branch),
    )
    .sort((a, b) => b.databaseId - a.databaseId)[0];
}
export async function waitForCI(
  repository: string,
  sha: string,
  options: {
    branch?: string;
    signal?: AbortSignal;
    failFast?: boolean;
    failedJobs?: (run: CIRun) => Promise<string[]>;
    timeoutMs?: number;
    query?: () => Promise<CIRun[]>;
    sleep?: (ms: number) => Promise<unknown>;
    progress?: (run: CIRun) => Promise<void>;
  } = {},
): Promise<CIRun> {
  const deadline = Date.now() + (options.timeoutMs ?? 30 * 60_000);
  let last = "";
  do {
    options.signal?.throwIfAborted();
    const runs: CIRun[] = await retryCIRead(
      async () =>
        options.query
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
                "databaseId,headSha,headBranch,event,status,conclusion,url",
              ]),
            ),
      options,
    );
    const run = selectCIRun(runs, sha, options.branch);
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
    if (run && options.failFast) {
      const failures: string[] = await retryCIRead(
        async () =>
          options.failedJobs
            ? await options.failedJobs(run)
            : JSON.parse(
                await gh([
                  "api",
                  `repos/${repository}/actions/runs/${run.databaseId}/jobs`,
                  "--jq",
                  '[.jobs[] | select(.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "cancelled") | .name]',
                ]),
              ),
        options,
      );
      if (failures.length)
        throw new Error(`CI检查失败：${failures.join(", ")}；${run.url}`);
    }
    options.signal?.throwIfAborted();
    if (Date.now() >= deadline) break;
    const wait = Math.min(5_000, deadline - Date.now());
    if (options.sleep) await options.sleep(wait);
    else await delay(wait, undefined, { signal: options.signal });
  } while (Date.now() < deadline);
  throw new Error(
    "等待CI超时，发布收据已保存。使用 pnpm push --resume 继续确认，不重复发布。",
  );
}

/** Re-query exact branch/SHA so an abort during Actions registration cannot cancel another run. */
export async function cancelCandidateCI(
  repository: string,
  sha: string,
  branch: string,
  options: {
    timeoutMs?: number;
    query?: () => Promise<CIRun[]>;
    cancel?: (id: number) => Promise<unknown>;
    sleep?: (ms: number) => Promise<unknown>;
  } = {},
): Promise<void> {
  if (!/^codex\/publish\/[a-f0-9]{40}\/[\w-]+$/.test(branch))
    throw new Error("只能取消本轮受管候选分支的CI。");
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  let requested: number | undefined;
  do {
    const runs: CIRun[] = await retryCIRead(
      async () =>
        options.query
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
                "databaseId,headSha,headBranch,event,status,conclusion,url",
              ]),
            ),
      options,
    );
    const run = selectCIRun(runs, sha, branch);
    if (run?.status === "completed") return;
    if (run && requested !== run.databaseId) {
      try {
        if (options.cancel) await options.cancel(run.databaseId);
        else
          await gh([
            "run",
            "cancel",
            String(run.databaseId),
            "--repo",
            repository,
          ]);
        requested = run.databaseId;
      } catch (error) {
        // A completed run can reject cancellation; only a subsequent read proves completion.
        console.error(
          `[push] CI取消请求未确认：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (Date.now() >= deadline) break;
    await (options.sleep ?? delay)(Math.min(1_000, deadline - Date.now()));
  } while (Date.now() <= deadline);
  throw new Error(
    `候选CI取消未确认：${branch} (${sha})。请回读此候选运行；不得视为已停止。`,
  );
}
