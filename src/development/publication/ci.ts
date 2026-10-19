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
export async function gh(
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  return (
    await execute("gh", args, {
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
      signal,
    })
  ).stdout.trim();
}

export class CIReadUnavailableError extends Error {
  readonly category = "ci-read-unavailable";
}
export class CIGateFailedError extends Error {
  readonly category = "ci-gate-failed";
}
export class CIWaitTimeoutError extends Error {
  readonly category = "ci-wait-timeout";
}
function transientRead(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // Certificate and permission errors require intervention, not a longer wait.
  return (
    !/x509:|certificate|HTTP 40[13]/i.test(message) &&
    ((error instanceof Error && "killed" in error && error.killed === true) ||
      /TLS handshake timeout|ECONNRESET|ETIMEDOUT|connection reset|connection refused|network is unreachable|i\/o timeout|HTTP 50[234]/i.test(
        message,
      ))
  );
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
      options.signal?.throwIfAborted();
      if (!transientRead(error)) throw error;
      if (attempt >= 2)
        throw new CIReadUnavailableError("CI只读查询暂时不可用。", {
          cause: error,
        });
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
    readRecoveryTimeoutMs?: number;
    now?: () => number;
    readState?: (state: {
      status: "unavailable" | "recovered";
      durationMs: number;
    }) => Promise<void>;
  } = {},
): Promise<CIRun> {
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 30 * 60_000);
  const recoveryBudget = options.readRecoveryTimeoutMs ?? 60_000;
  let unavailableSince: number | undefined;
  let last = "";
  do {
    options.signal?.throwIfAborted();
    const readStarted = now();
    const readTimeout = AbortSignal.timeout(
      Math.max(
        1,
        Math.min(
          deadline - now(),
          (unavailableSince ?? readStarted) + recoveryBudget - now(),
        ),
      ),
    );
    const readSignal = options.signal
      ? AbortSignal.any([options.signal, readTimeout])
      : readTimeout;
    try {
      const runs: CIRun[] = await retryCIRead(
        async () =>
          options.query
            ? await options.query()
            : JSON.parse(
                await gh(
                  [
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
                  ],
                  readSignal,
                ),
              ),
        { ...options, signal: readSignal },
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
          throw new CIGateFailedError(
            `CI ${run.conclusion}: ${run.url}。修复后重新发布；仅重新运行CI时使用 pnpm push --resume。`,
          );
        if (unavailableSince !== undefined)
          await options.readState?.({
            status: "recovered",
            durationMs: now() - unavailableSince,
          });
        return run;
      }
      if (run && options.failFast) {
        const failures: string[] = await retryCIRead(
          async () =>
            options.failedJobs
              ? await options.failedJobs(run)
              : JSON.parse(
                  await gh(
                    [
                      "api",
                      `repos/${repository}/actions/runs/${run.databaseId}/jobs`,
                      "--jq",
                      '[.jobs[] | select(.conclusion == "failure" or .conclusion == "timed_out" or .conclusion == "cancelled") | .name]',
                    ],
                    readSignal,
                  ),
                ),
          { ...options, signal: readSignal },
        );
        if (failures.length)
          throw new CIGateFailedError(
            `CI检查失败：${failures.join(", ")}；${run.url}`,
          );
      }
      if (unavailableSince !== undefined) {
        await options.readState?.({
          status: "recovered",
          durationMs: now() - unavailableSince,
        });
        unavailableSince = undefined;
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      const timedOut =
        readTimeout.aborted &&
        (error === readSignal.reason ||
          (error instanceof Error && error.name === "AbortError"));
      if (!(error instanceof CIReadUnavailableError) && !timedOut) throw error;
      if (unavailableSince === undefined) {
        unavailableSince = readStarted;
        console.error(
          "[push] CI只读查询暂时不可用；保留本机检查，有界等待恢复，未确认前禁止发布。",
        );
        await options.readState?.({
          status: "unavailable",
          durationMs: now() - unavailableSince,
        });
      }
      if (
        now() >= deadline ||
        now() - unavailableSince >= recoveryBudget ||
        readTimeout.aborted
      )
        throw new CIReadUnavailableError(
          "CI只读查询恢复超时，结果仍未知，禁止发布。",
          { cause: error },
        );
    }
    options.signal?.throwIfAborted();
    if (now() >= deadline) break;
    const wait = Math.min(
      5_000,
      deadline - now(),
      unavailableSince === undefined
        ? Infinity
        : unavailableSince + recoveryBudget - now(),
    );
    if (options.sleep) await options.sleep(wait);
    else await delay(wait, undefined, { signal: options.signal });
  } while (now() < deadline);
  throw new CIWaitTimeoutError(
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
