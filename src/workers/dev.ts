import { assertActiveSnapshotCompatible } from "@/development/data-sync/startup";
import { getWorkbenchOrigin, getWorkbenchPort } from "@/config/data-sync-state";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Console } from "node:console";
import { watch, type FSWatcher } from "node:fs";
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
  setCommandOutput,
  writeJson,
} from "@/development/runtime";
import { sampleInputs, type SampleResult } from "@/development/sample";
import { warmCatalogRoutes } from "@/development/warm-catalog";
import { stopChildTree } from "@/development/process";
import { cleanupStoppedDockerResources } from "@/development/docker-resources";
import { withTestEnvironment } from "@/development/test-environment";
import { stopPersistentDataStack } from "@/server/environment/data-stack-lifecycle";
import type { WorkbenchStatus } from "@/development/protocol";
import {
  getPreviewDataSource,
  previewEnvironment,
  previewNodeOptions,
} from "@/development/preview";
import { reportStorageBudget } from "@/development/storage-audit";
import { RotatingLog } from "@/development/rotating-log";
import {
  createWorkbenchClient,
  hasWorkbenchClients,
} from "@/development/workbench-clients";
import {
  automaticStorageCleanup,
  readStoragePolicy,
  trimStoppedDevelopmentCache,
} from "@/development/storage";

const origin = getWorkbenchOrigin();
const ownerPath = resolve(developmentRoot, "owner.json");
const statusPath = resolve(developmentRoot, "status.json");
const controlPath = resolve(developmentRoot, "command.json");
interface Owner {
  pid: number;
  instance: string;
  workspace: string;
}

async function requestStop(owner: Owner, keepDatabase = false): Promise<void> {
  await writeJson(controlPath, {
    action: "stop",
    instance: owner.instance,
    keepDatabase,
  });
  if (process.platform !== "win32") process.kill(owner.pid, "SIGTERM");
  const deadline = Date.now() + 45_000;
  while (processAlive(owner.pid) && Date.now() < deadline) await delay(150);
  if (processAlive(owner.pid))
    throw new Error("Previous workbench is still stopping; see its log.");
  const final = await readJson<WorkbenchStatus>(statusPath);
  if (final?.instance === owner.instance && final.phase === "error")
    throw new Error(final.message);
}

async function cleanStoppedResources(): Promise<void> {
  try {
    await withTestEnvironment(async () => undefined, {
      clean: true,
      lockWaitMs: 0,
    });
    await cleanupStoppedDockerResources();
  } catch (error) {
    console.warn(
      `[cleanup] Deferred: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function stopDatabase(
  source: "development" | "local-review",
): Promise<void> {
  const releaseDatabase = await acquireLock(`${source}-database`, 0);
  try {
    await stopPersistentDataStack(source);
  } finally {
    await releaseDatabase();
  }
}

async function main(): Promise<void> {
  getPreviewDataSource(); // Load local settings before choosing the ready URL or spawning the supervisor.
  await mkdir(developmentRoot, { recursive: true });
  if (process.argv.includes("--serve")) return serve();
  let owner = await readJson<Owner>(ownerPath);
  if (
    process.argv.includes("--restart") &&
    owner &&
    owner.workspace === process.cwd() &&
    processAlive(owner.pid)
  ) {
    await requestStop(owner, true);
    owner = null;
  }
  if (process.argv.includes("--stop")) {
    if (owner && owner.workspace === process.cwd() && processAlive(owner.pid)) {
      await requestStop(owner, process.argv.includes("--keep-database"));
    } else if (!process.argv.includes("--keep-database")) {
      const release = await acquireLock("workbench", 0);
      try {
        if (process.env.MEDOTA2_WORKBENCH_MAPS_ONLY !== "1")
          await stopDatabase(getPreviewDataSource());
        await cleanStoppedResources();
        if (process.env.MEDOTA2_AUTO_CLEANUP !== "0" && !process.env.CI)
          await trimStoppedDevelopmentCache().catch((error: unknown) => {
            console.warn(
              "Development cache cleanup deferred:",
              error instanceof Error ? error.message : String(error),
            );
          });
        await automaticStorageCleanup("tests");
        await automaticStorageCleanup("releases");
      } finally {
        await release();
      }
    }
    console.log(
      process.argv.includes("--keep-database")
        ? "Shared Web stopped; database remains available for snapshot checks."
        : "Shared workbench stopped; containers removed and database volumes retained.",
    );
    return;
  }
  const previousStatus = await readJson<WorkbenchStatus>(statusPath);
  if (
    owner &&
    previousStatus?.instance === owner.instance &&
    ["stopped", "error"].includes(previousStatus.phase)
  ) {
    const deadline = Date.now() + 45_000;
    while (processAlive(owner.pid) && Date.now() < deadline) await delay(150);
    if (processAlive(owner.pid))
      throw new Error("Previous workbench is still stopping.");
    owner = null;
  }
  await attach(owner);
}

async function attach(owner: Owner | null): Promise<void> {
  let closing = false;
  const close = () => {
    closing = true;
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.on(signal, close);
  process.on("disconnect", close);
  if (process.stdin.isTTY) {
    process.stdin.on("end", close);
    process.stdin.on("close", close);
    process.stdin.on("error", close);
    process.stdin.resume();
  }
  let client: Awaited<ReturnType<typeof createWorkbenchClient>> | undefined;
  let expectedPid = owner?.pid;
  let announced = false;
  try {
    client = await createWorkbenchClient(developmentRoot);
    if (
      !owner ||
      owner.workspace !== process.cwd() ||
      !processAlive(owner.pid)
    ) {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "src/workers/dev.ts", "--serve"],
        {
          cwd: process.cwd(),
          env: process.env,
          detached: true,
          windowsHide: true,
          stdio: "ignore",
        },
      );
      expectedPid = child.pid;
      child.unref();
    }
    let deadline = Date.now() + 180_000;
    let replacing: string | undefined;
    while (!closing && client.parentAlive()) {
      await client.pulse();
      const current = await readJson<Owner>(ownerPath);
      const status = await readJson<WorkbenchStatus>(statusPath);
      if (announced && current && current.pid !== expectedPid) {
        announced = false;
        deadline = Date.now() + 180_000;
      }
      if (
        status?.phase === "stopped" &&
        status.instance === current?.instance
      ) {
        const command = await readJson<{
          instance: string;
          keepDatabase?: boolean;
        }>(controlPath);
        if (command?.instance === current.instance && command.keepDatabase) {
          if (replacing !== current.instance) {
            replacing = current.instance;
            deadline = Date.now() + 180_000;
            announced = false;
          }
          if (Date.now() >= deadline)
            throw new Error("Workbench replacement timed out.");
          await delay(350);
          continue;
        }
      }
      if (
        current &&
        current.pid === expectedPid &&
        status?.instance === current.instance &&
        (status.phase === "error" || status.phase === "stopped")
      ) {
        if (status.phase === "stopped" && announced) return;
        throw new Error(
          status.phase === "stopped"
            ? "Workbench startup was cancelled."
            : status.message,
        );
      }
      if (
        current &&
        processAlive(current.pid) &&
        status?.instance === current.instance
      ) {
        if (status.phase === "error") throw new Error(status.message);
        if (status.phase === "ready" && !announced) {
          const health = (await fetch(`${origin}/api/development`, {
            signal: AbortSignal.timeout(1500),
          })
            .then((response) => response.json())
            .catch(() => null)) as WorkbenchStatus | null;
          if (health?.instance === current.instance) {
            console.log(
              `Shared workbench ready: ${origin}/${process.env.MEDOTA2_WORKBENCH_MAPS_ONLY === "1" ? "map" : "heroes"}\nLog: .medota2/development/server.log\nKeep this terminal open. Ctrl+C or closing the last dev terminal stops and cleans the workbench.`,
            );
            announced = true;
            expectedPid = current.pid;
            if (process.connected) process.send?.({ kind: "ready" });
          }
        }
      }
      if (announced && (!current || !processAlive(current.pid))) return;
      if (!announced && Date.now() >= deadline)
        throw new Error(
          "Workbench startup timed out. See .medota2/development/server.log.",
        );
      await delay(350);
    }
  } finally {
    await client?.close();
    if (!(await hasWorkbenchClients(developmentRoot))) {
      const deadline = Date.now() + 45_000;
      while (expectedPid && processAlive(expectedPid) && Date.now() < deadline)
        await delay(150);
      if (expectedPid && processAlive(expectedPid))
        throw new Error(
          "Workbench is still stopping; see .medota2/development/server.log.",
        );
      const final = await readJson<WorkbenchStatus>(statusPath);
      if (final?.phase === "error") throw new Error(final.message);
    }
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
      process.off(signal, close);
    process.off("disconnect", close);
    if (process.stdin.isTTY) {
      process.stdin.pause();
      process.stdin.off("end", close);
      process.stdin.off("close", close);
      process.stdin.off("error", close);
    }
  }
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
  let storageMonitor: NodeJS.Timeout | undefined;
  const preparation = new AbortController();
  let preparing: Promise<void> | undefined;
  let databaseSource: "development" | "local-review" | undefined;
  let stopping = false,
    savedAt = Date.now();
  const changed = new Set<string>();
  let activeRevision = 0;
  let log: RotatingLog | undefined;
  let restoreOutput: (() => void) | undefined;
  const originalConsole = console;
  const stop = async (code = 0) => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    clearInterval(controls);
    clearInterval(startupControls);
    clearInterval(clientControls);
    clearInterval(storageMonitor);
    watchers.forEach((watcher) => watcher.close());
    preparation.abort();
    await preparing?.catch(() => undefined);
    try {
      await stopChildTree(web);
      await stopChildTree(sample);
      const command = await readJson<{
        instance: string;
        action: string;
        keepDatabase?: boolean;
      }>(controlPath);
      const keepDatabase =
        command?.instance === instance &&
        command.action === "stop" &&
        command.keepDatabase === true;
      if (!keepDatabase && databaseSource) await stopDatabase(databaseSource);
      if (!keepDatabase) {
        await cleanStoppedResources();
        if (process.env.MEDOTA2_AUTO_CLEANUP !== "0" && !process.env.CI)
          await trimStoppedDevelopmentCache().catch((error: unknown) => {
            console.warn(
              "Development cache cleanup deferred:",
              error instanceof Error ? error.message : String(error),
            );
          });
        await automaticStorageCleanup("tests");
        await automaticStorageCleanup("releases");
      }
    } catch (error) {
      code = 1;
      await publish({
        message: `Shutdown failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    await publish({ phase: code ? "error" : "stopped" });
    restoreOutput?.();
    globalThis.console = originalConsole;
    if (log && !log.destroyed)
      await new Promise<void>((accept) => log!.end(accept));
    await release?.();
    process.exitCode = code;
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  process.on("SIGHUP", () => void stop());
  let checkingClients = false;
  const clientControls = setInterval(() => {
    if (stopping || checkingClients) return;
    checkingClients = true;
    void hasWorkbenchClients(developmentRoot)
      .then((active) => {
        if (!active) void stop();
      })
      .catch(
        (error) => void publish({ message: String(error) }).then(() => stop(1)),
      )
      .finally(() => {
        checkingClients = false;
      });
  }, 500);
  // Windows uses the control file while database preparation is still in progress.
  const startupControls = setInterval(() => {
    void readJson<{ action: string; instance: string }>(controlPath)
      .then((command) => {
        if (command?.instance === instance && command.action === "stop")
          void stop();
      })
      .catch(() => undefined);
  }, 250);
  try {
    log = await RotatingLog.create(process.cwd(), await readStoragePolicy());
    globalThis.console = new Console(log, log);
    restoreOutput = setCommandOutput(log);
    log.on("error", (error) => {
      void publish({ message: `Workbench log failed: ${error.message}` }).then(
        () => stop(1),
      );
    });
    const occupied = await fetch(`${origin}/api/development`, {
      signal: AbortSignal.timeout(600),
    })
      .then(() => true)
      .catch(() => false);
    if (occupied)
      throw new Error(
        `Port ${getWorkbenchPort()} already belongs to a server. Stop or coordinate that server before starting the shared workbench.`,
      );
    await cleanStoppedResources();
    if (stopping) return;
    const mapsOnly = process.env.MEDOTA2_WORKBENCH_MAPS_ONLY === "1";
    const dataSource = mapsOnly ? "development" : getPreviewDataSource();
    if (mapsOnly && !process.env.DOTA_MAP_COLLECTION_PATH)
      throw new Error("Map-only workbench requires DOTA_MAP_COLLECTION_PATH");
    const databaseEnv = previewEnvironment(dataSource);
    await assertActiveSnapshotCompatible();
    await publish({
      dataSource,
      message: mapsOnly
        ? "准备独立的地图版本集合"
        : dataSource === "local-review"
          ? "准备真实数据并检查头像资产"
          : "准备开发数据；空库使用含占位图的测试样例",
    });
    if (stopping) return;
    if (!mapsOnly) databaseSource = dataSource;
    preparing = (async () => {
      if (mapsOnly) {
        const { readCollection } = await import("@/server/map/packages");
        await readCollection(process.env.DOTA_MAP_COLLECTION_PATH!);
      } else if (dataSource === "local-review") {
        const releaseDatabase = await acquireLock(
          "local-review-database",
          undefined,
          preparation.signal,
        );
        try {
          await run(
            "pnpm",
            ["exec", "tsx", "src/workers/prepare-local-review.ts"],
            databaseEnv,
            undefined,
            preparation.signal,
          );
          await run(
            "pnpm",
            ["exec", "tsx", "src/workers/audit-assets.ts"],
            {
              ...databaseEnv,
              MEDOTA2_PROCESS_ROLE: "web",
            },
            undefined,
            preparation.signal,
          );
        } finally {
          await releaseDatabase();
        }
      } else
        await run(
          "pnpm",
          ["exec", "tsx", "src/workers/prepare-development.ts"],
          databaseEnv,
          undefined,
          preparation.signal,
        );
    })();
    await preparing;
    if (stopping) return;
    const env = {
      ...databaseEnv,
      NODE_OPTIONS: previewNodeOptions(databaseEnv.NODE_OPTIONS),
      MEDOTA2_WORKBENCH: "1",
      MEDOTA2_PROCESS_ROLE: "web",
      NEXT_DIST_DIR: ".next",
    };
    web = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "dev",
        "--turbopack",
        "-H",
        "127.0.0.1",
        "-p",
        String(getWorkbenchPort()),
      ],
      { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    web.stdout?.pipe(log, { end: false });
    web.stderr?.pipe(log, { end: false });
    web.once("error", (error) => {
      void publish({ message: error.message }).then(() => stop(1));
    });
    web.once("close", (code) => {
      if (!stopping)
        void publish({
          message: `Web 服务已退出（${code}）；查看开发日志后重新运行 pnpm dev。`,
        }).then(() => stop(1));
    });
    await publish({
      message: mapsOnly
        ? "正在启动地图工作台"
        : "正在预热图鉴、详情路由与本机缓存接口",
    });
    try {
      if (!mapsOnly) await warmCatalogRoutes(origin, preparation.signal);
    } catch (error) {
      // Warmup is an optimization, not a substitute for the verified data/setup
      // gates above. Keep a usable workbench if optional cache warmup fails.
      console.warn(
        "Catalog warmup incomplete:",
        error instanceof Error ? error.message : String(error),
      );
    }
    if (stopping) return;
    await publish({
      phase: "ready",
      message: "界面热更新已启动，正在计算小样例",
    });
    // Reclaim expired test/build artifacts even after days without running tests.
    // Cleanup uses non-blocking scope locks and retains active/pinned evidence.
    const maintainIdleStorage = async () => {
      await automaticStorageCleanup("tests");
      await automaticStorageCleanup("releases");
      await automaticStorageCleanup("data-sync");
      await reportStorageBudget();
    };
    void maintainIdleStorage();
    storageMonitor = setInterval(() => void maintainIdleStorage(), 6 * 3600000);
    storageMonitor.unref();

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
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        },
      );
      child.stdout?.pipe(log!, { end: false });
      child.stderr?.pipe(log!, { end: false });
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
    clearInterval(startupControls);
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
          if (command.action === "stop") {
            await stop();
            return;
          }
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
    if (stopping) return;
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
