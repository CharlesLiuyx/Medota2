import { assertActiveSnapshotCompatible } from "@/development/data-sync/startup";
import { getWorkbenchOrigin, getWorkbenchPort } from "@/config/data-sync-state";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  acquireLock,
  developmentRoot,
  fingerprint,
  processAlive,
  readJson,
  run,
  writeJson,
} from "@/development/runtime";
import { sampleInputs, type SampleResult } from "@/development/sample";
import { warmCatalogRoutes } from "@/development/warm-catalog";
import type { WorkbenchStatus } from "@/development/protocol";
import {
  getPreviewDataSource,
  previewEnvironment,
} from "@/development/preview";

const origin = getWorkbenchOrigin();
const ownerPath = resolve(developmentRoot, "owner.json");
const statusPath = resolve(developmentRoot, "status.json");
const controlPath = resolve(developmentRoot, "command.json");
interface Owner {
  pid: number;
  instance: string;
  workspace: string;
}

async function main(): Promise<void> {
  await mkdir(developmentRoot, { recursive: true });
  if (process.argv.includes("--serve")) return serve();
  let owner = await readJson<Owner>(ownerPath);
  if (
    process.argv.includes("--restart") &&
    owner &&
    owner.workspace === process.cwd() &&
    processAlive(owner.pid)
  ) {
    process.kill(owner.pid, "SIGTERM");
    const deadline = Date.now() + 15_000;
    while (processAlive(owner.pid) && Date.now() < deadline) await delay(150);
    if (processAlive(owner.pid))
      throw new Error("Previous workbench is still stopping; see its log.");
    owner = null;
  }
  if (process.argv.includes("--stop")) {
    if (owner && owner.workspace === process.cwd() && processAlive(owner.pid)) {
      process.kill(owner.pid, "SIGTERM");
      const deadline = Date.now() + 15_000;
      while (processAlive(owner.pid) && Date.now() < deadline) await delay(150);
      if (processAlive(owner.pid))
        throw new Error("Previous workbench is still stopping; see its log.");
      console.log("Shared workbench stopped; database data is retained.");
    } else console.log("Shared workbench is not running.");
    return;
  }
  let expectedPid = owner?.pid;
  if (!owner || owner.workspace !== process.cwd() || !processAlive(owner.pid)) {
    const log = openSync(resolve(developmentRoot, "server.log"), "a", 0o600);
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "src/workers/dev.ts", "--serve"],
      {
        cwd: process.cwd(),
        env: process.env,
        detached: true,
        stdio: ["ignore", log, log],
      },
    );
    expectedPid = child.pid;
    closeSync(log);
    child.unref();
  }
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const current = await readJson<Owner>(ownerPath);
    const status = await readJson<WorkbenchStatus>(statusPath);
    if (
      current &&
      current.pid === expectedPid &&
      status?.instance === current.instance &&
      status.phase === "error"
    )
      throw new Error(status.message);
    if (
      current &&
      processAlive(current.pid) &&
      status?.instance === current.instance
    ) {
      if (status.phase === "error") throw new Error(status.message);
      if (status.phase === "ready") {
        const health = (await fetch(`${origin}/api/development`, {
          signal: AbortSignal.timeout(1500),
        })
          .then((response) => response.json())
          .catch(() => null)) as WorkbenchStatus | null;
        if (health?.instance === current.instance) {
          console.log(
            `Shared workbench ready: ${origin}/heroes\nLog: .medota2/development/server.log`,
          );
          return;
        }
      }
    }
    await delay(350);
  }
  throw new Error(
    "Workbench startup timed out. See .medota2/development/server.log.",
  );
}

async function serve(): Promise<void> {
  let release: (() => Promise<void>) | undefined;
  try {
    release = await acquireLock("workbench", 0);
  } catch {
    return;
  } // A simultaneous pnpm dev already owns startup.
  const instance = randomUUID();
  const owner: Owner = { pid: process.pid, instance, workspace: process.cwd() };
  await writeJson(ownerPath, owner);
  let status: WorkbenchStatus = {
    schemaVersion: 1,
    instance,
    phase: "starting",
    revision: 0,
    sample: "queued",
    changedFiles: [],
    message: "准备共享开发环境",
    updatedAt: new Date().toISOString(),
    pendingSetup: [],
  };
  let writes = Promise.resolve();
  function publish(patch: Partial<WorkbenchStatus>): Promise<void> {
    status = { ...status, ...patch, updatedAt: new Date().toISOString() };
    const snapshot = { ...status };
    writes = writes.then(() => writeJson(statusPath, snapshot));
    return writes;
  }
  await publish({});
  let web: ChildProcess | undefined, sample: ChildProcess | undefined;
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined, controls: NodeJS.Timeout | undefined;
  let stopping = false,
    savedAt = Date.now();
  const changed = new Set<string>();
  let activeRevision = 0;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    clearInterval(controls);
    watchers.forEach((watcher) => watcher.close());
    web?.kill("SIGTERM");
    sample?.kill("SIGTERM");
    await publish({ phase: code ? "error" : "stopped" });
    await release?.();
    process.exitCode = code;
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
  try {
    const occupied = await fetch(`${origin}/api/development`, {
      signal: AbortSignal.timeout(600),
    })
      .then(() => true)
      .catch(() => false);
    if (occupied)
      throw new Error(
        `Port ${getWorkbenchPort()} already belongs to a server. Stop or coordinate that server before starting the shared workbench.`,
      );
    const dataSource = getPreviewDataSource();
    const databaseEnv = previewEnvironment(dataSource);
    await assertActiveSnapshotCompatible();
    await publish({
      dataSource,
      message:
        dataSource === "local-review"
          ? "准备真实数据并检查头像资产"
          : "准备开发数据；空库使用含占位图的测试样例",
    });
    if (dataSource === "local-review") {
      const releaseDatabase = await acquireLock("local-review-database");
      try {
        await run(
          "pnpm",
          ["exec", "tsx", "src/workers/prepare-local-review.ts"],
          databaseEnv,
        );
        await run("pnpm", ["exec", "tsx", "src/workers/audit-assets.ts"], {
          ...databaseEnv,
          MEDOTA2_PROCESS_ROLE: "web",
        });
      } finally {
        await releaseDatabase();
      }
    } else
      await run(
        "pnpm",
        ["exec", "tsx", "src/workers/prepare-development.ts"],
        databaseEnv,
      );
    if (stopping) return;
    const env = {
      ...databaseEnv,
      MEDOTA2_WORKBENCH: "1",
      MEDOTA2_PROCESS_ROLE: "web",
      NEXT_DIST_DIR: ".next",
    };
    web = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--webpack",
        "-H",
        "127.0.0.1",
        "-p",
        String(getWorkbenchPort()),
      ],
      { env, stdio: "inherit" },
    );
    web.once("error", (error) => {
      void publish({ message: error.message }).then(() => stop(1));
    });
    web.once("close", (code) => {
      if (!stopping)
        void publish({
          message: `Web 服务已退出（${code}）；查看开发日志后重新运行 pnpm dev。`,
        }).then(() => stop(1));
    });
    await publish({ message: "正在预热图鉴、详情路由与本机缓存接口" });
    try {
      await warmCatalogRoutes(origin);
    } catch (error) {
      // Warmup is an optimization, not a substitute for the verified data/setup
      // gates above. Keep a usable workbench if optional cache warmup fails.
      console.warn(
        "Catalog warmup incomplete:",
        error instanceof Error ? error.message : String(error),
      );
    }
    await publish({
      phase: "ready",
      message: "界面热更新已启动，正在计算小样例",
    });

    async function calculate(): Promise<void> {
      if (stopping) return;
      const revision = ++activeRevision;
      sample?.kill("SIGTERM");
      const files = [...changed].sort();
      changed.clear();
      await publish({
        revision,
        sample: "running",
        changedFiles: files,
        message: "正在用真实解析器重算小样例",
      });
      const input = await fingerprint(sampleInputs);
      if (revision !== activeRevision || stopping) return;
      const cache = await readJson<{ input: string; result: SampleResult }>(
        resolve(developmentRoot, "sample-cache.json"),
      );
      if (revision !== activeRevision || stopping) return;
      if (cache?.input === input) {
        await publish({
          sample: "passed",
          result: cache.result,
          resultRevision: revision,
          savedToResultMs: Date.now() - savedAt,
          message: "输入与代码未变，已复用小样例结果",
        });
        return;
      }
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/workers/run-development-sample.ts"],
        {
          env: { ...env, MEDOTA2_PROCESS_ROLE: "worker" },
          stdio: ["ignore", "inherit", "inherit", "ipc"],
        },
      );
      sample = child;
      let received = false;
      child.once(
        "message",
        async (value: { result?: SampleResult; error?: string }) => {
          received = true;
          if (revision !== activeRevision || stopping) return;
          if ((await fingerprint(sampleInputs)) !== input) {
            schedule("计算期间输入变化");
            return;
          }
          if (revision !== activeRevision || stopping) return;
          if (value.error || !value.result) {
            await publish({
              sample: "error",
              message: value.error ?? "样例没有返回结果",
            });
            return;
          }
          await writeJson(resolve(developmentRoot, "sample-cache.json"), {
            input,
            result: value.result,
          });
          if (revision !== activeRevision || stopping) return;
          await publish({
            sample: "passed",
            result: value.result,
            resultRevision: revision,
            savedToResultMs: Date.now() - savedAt,
            message: "小样例已更新",
          });
        },
      );
      child.once("error", (error) => {
        if (revision === activeRevision)
          void publish({ sample: "error", message: error.message });
      });
      child.once("close", (code) => {
        if (!received && revision === activeRevision && !stopping)
          void publish({
            sample: "error",
            message: `计算进程退出（${code}），修复后保存会自动重跑。`,
          });
      });
    }
    function schedule(path: string): void {
      changed.add(path);
      savedAt = Date.now();
      activeRevision += 1;
      sample?.kill("SIGTERM");
      void publish({
        sample: "queued",
        revision: activeRevision,
        message: "改动已保存，等待重算",
      });
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          void calculate().catch((error) =>
            publish({ sample: "error", message: String(error) }),
          ),
        180,
      );
    }
    for (const path of ["src", "tests/fixtures/vpk"]) {
      watchers.push(
        watch(path, { recursive: true }, (_, name) => {
          if (!name || name.endsWith(".tmp")) return;
          const file = `${path}/${name.toString().replaceAll("\\", "/")}`;
          if (
            file === "src/workers/dev.ts" ||
            file === "src/workers/prepare-development.ts" ||
            file.startsWith("src/config/") ||
            file.startsWith("src/development/")
          )
            void publish({
              pendingSetup: [
                ...new Set([
                  ...status.pendingSetup,
                  "工作台或运行配置已变化，运行 pnpm dev:restart 载入改动",
                ]),
              ],
            });
          if (
            sampleInputs.some(
              (input) => file === input || file.startsWith(`${input}/`),
            )
          )
            schedule(file);
          else if (file.startsWith("src/server/")) schedule(file);
        }),
      );
    }
    watchers.push(
      watch(".", (_, name) => {
        if (
          name &&
          [
            ".env",
            ".env.local",
            ".env.development",
            ".env.development.local",
            "package.json",
            "pnpm-lock.yaml",
            "next.config.ts",
            "tsconfig.json",
          ].includes(String(name))
        ) {
          void publish({
            pendingSetup: [
              ...new Set([
                ...status.pendingSetup,
                `${name} 已变化，运行 pnpm dev:restart 载入配置`,
              ]),
            ],
          });
        }
      }),
    );
    watchers.push(
      watch("drizzle", (_, name) => {
        if (name?.endsWith(".sql"))
          void publish({
            pendingSetup: [
              ...new Set([
                ...status.pendingSetup,
                "数据库结构已变化，运行 pnpm dev:restart 执行迁移并恢复预览",
              ]),
            ],
          });
      }),
    );
    let lastCommand = "";
    controls = setInterval(() => {
      void readFile(controlPath, "utf8")
        .then(async (content) => {
          if (content === lastCommand) return;
          lastCommand = content;
          const command = JSON.parse(content) as {
            action: string;
            instance: string;
          };
          if (command.instance !== instance) return;
          if (command.action === "cancel") {
            activeRevision += 1;
            clearTimeout(timer);
            sample?.kill("SIGTERM");
            await publish({
              sample: "cancelled",
              revision: activeRevision,
              message: "本次计算已取消；再次保存或点击重算继续",
            });
          }
          if (command.action === "rerun") {
            await unlink(resolve(developmentRoot, "sample-cache.json")).catch(
              () => undefined,
            );
            schedule("手动重算");
          }
        })
        .catch(() => undefined);
    }, 250);
    schedule("启动工作台");
  } catch (error) {
    await publish({
      message: error instanceof Error ? error.message : String(error),
    });
    await stop(1);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
