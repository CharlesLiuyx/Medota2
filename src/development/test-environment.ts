import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import {
  createTestRunContext,
  type TestRunContext,
} from "@/testing/test-run-harness";
import {
  createDataStackPlan,
  destroyDataStack,
  provisionDataStack,
  type DataStackLease,
} from "@/server/environment/data-stack-lifecycle";
import {
  acquireLock,
  CommandAbortedError,
  fingerprint,
  readJson,
  run,
  writeJson,
} from "./runtime";
import { removeRetiredTestBuild } from "./storage";

const path = resolve(".medota2/shared-tests/environment.json");
interface SharedEnvironment {
  context: TestRunContext;
  lease: DataStackLease;
}

export class TestInputsChangedError extends Error {
  constructor() {
    super("Related inputs changed during verification; this result is stale.");
    this.name = "TestInputsChangedError";
  }
}

/** The lease remains test-only; every writer holds this lock for the whole task. */
export async function withTestEnvironment<T>(
  work: (environment: NodeJS.ProcessEnv, context: TestRunContext) => Promise<T>,
  options: {
    seed?: boolean;
    clean?: boolean;
    verify?: () => Promise<void>;
    signal?: AbortSignal;
    lockWaitMs?: number;
  } = {},
): Promise<T | undefined> {
  const cancellation = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, cancellation.signal])
    : cancellation.signal;
  const cancel = () =>
    cancellation.abort(new CommandAbortedError("Test environment cancelled."));
  // Keep handlers installed through provision and cleanup, including repeated signals.
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  let release: (() => Promise<void>) | undefined;
  let saved: SharedEnvironment | null = null;
  let owned = false;
  try {
    release = await acquireLock("test-database", options.lockWaitMs, signal);
    saved = await readJson<SharedEnvironment>(path);
    if (saved && saved.context.workspaceRoot !== process.cwd())
      throw new Error("Shared test lease belongs to another workspace.");
    owned = true;
    if (saved) {
      // A previous interrupted task may have left its exact disposable lease.
      await destroyDataStack(saved.lease);
      await writeJson(path, null);
      const retired = saved.context;
      saved = null;
      await removeRetiredTestBuild(retired);
    }
    if (options.clean) return;
    if (!saved) {
      const context = await createTestRunContext("integration");
      saved = {
        context,
        lease: createDataStackPlan({
          environment: "test",
          runId: context.runId,
          hostPort: context.databasePort,
          workspaceRoot: process.cwd(),
        }),
      };
      // Persist the exact target before Docker starts, for recovery after SIGKILL/host loss.
      await writeJson(path, saved);
      const lease = await provisionDataStack({
        environment: "test",
        runId: context.runId,
        hostPort: context.databasePort,
        onProgress: console.log,
      });
      saved = { context, lease };
      await writeJson(path, saved);
    }
    signal.throwIfAborted();
    const { context } = saved;
    const runRoot = resolve(
      ".medota2/shared-tests/runs",
      `${Date.now()}-${randomUUID().slice(0, 8)}`,
    );
    await mkdir(runRoot, { recursive: true });
    await mkdir(context.runRoot, { recursive: true });
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      MEDOTA2_WORKBENCH: "0",
      MEDOTA2_ENVIRONMENT: "test",
      MEDOTA2_DATA_CLASS: "synthetic-fixture",
      MEDOTA2_PROCESS_ROLE: "control",
      MEDOTA2_RUN_ID: context.runId,
      MEDOTA2_STATE_DIRECTORY: context.stateDirectory,
      MEDOTA2_NETWORK_POLICY: "loopback-only",
      MEDOTA2_ARTIFACT_ROOT: runRoot,
      MEDOTA2_TEST_WEB_PORT: String(context.webPort),
      NEXT_DIST_DIR: relative(
        process.cwd(),
        context.nextDistDirectory,
      ).replaceAll("\\", "/"),
      MEDOTA2_NEXT_TSCONFIG: relative(
        process.cwd(),
        context.nextTsconfigPath,
      ).replaceAll("\\", "/"),
    };
    // Turbopack reads these as config paths, including on Windows.
    const fromRun = relative(context.runRoot, process.cwd()).replaceAll(
      "\\",
      "/",
    );
    await writeJson(context.nextTsconfigPath, {
      extends: `${fromRun}/tsconfig.json`,
      include: [
        `${fromRun}/next-env.d.ts`,
        `${fromRun}/src/**/*.ts`,
        `${fromRun}/src/**/*.tsx`,
        "next/types/**/*.ts",
        "next/dev/types/**/*.ts",
      ],
      exclude: [`${fromRun}/node_modules`],
    });
    await run(
      "pnpm",
      ["exec", "tsx", "src/workers/migrate-test.ts"],
      {
        ...env,
        MEDOTA2_PROCESS_ROLE: "migration",
      },
      undefined,
      signal,
    );
    const seedInput = await fingerprint([
      "drizzle",
      "src/importers",
      "src/domain",
      "src/server/assets",
      "src/lib",
      "tests/helpers",
      "tests/fixtures",
      "package.json",
      "pnpm-lock.yaml",
    ]);
    if (options.seed) {
      await run(
        "pnpm",
        [
          "exec",
          "tsx",
          "tests/helpers/seed-test-database.ts",
          "--include-large-list",
        ],
        { ...env, MEDOTA2_PROCESS_ROLE: "migration" },
        undefined,
        signal,
      );
    }
    const evidence = {
      schemaVersion: 1,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      status: "running",
      databaseRunId: context.runId,
      fixtureInput: seedInput,
    };
    await writeJson(resolve(runRoot, "run.json"), evidence);
    try {
      const result = await work(env, context);
      // Validate before publishing the receipt, while the fixture lease is held.
      // A passing runner with changed inputs is not a passing verification.
      signal.throwIfAborted();
      await options.verify?.();
      return result;
    } catch (error) {
      evidence.status =
        error instanceof TestInputsChangedError ? "stale" : "failed";
      throw error;
    } finally {
      await writeJson(resolve(runRoot, "run.json"), {
        ...evidence,
        status: evidence.status === "running" ? "passed" : evidence.status,
        finishedAt: new Date().toISOString(),
      });
    }
  } finally {
    try {
      // Reuse within this locked batch only. tmpfs is disposable after the task.
      if (owned && saved) {
        await destroyDataStack(saved.lease);
        await writeJson(path, null);
        await removeRetiredTestBuild(saved.context);
      }
    } finally {
      await release?.();
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
    }
  }
}
