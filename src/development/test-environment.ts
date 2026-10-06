import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import {
  createTestRunContext,
  type TestRunContext,
} from "@/testing/test-run-harness";
import {
  destroyDataStack,
  provisionDataStack,
  type DataStackLease,
} from "@/server/environment/data-stack-lifecycle";
import { acquireLock, fingerprint, readJson, run, writeJson } from "./runtime";

const execute = promisify(execFile);
const path = resolve(".medota2/shared-tests/environment.json");
interface SharedEnvironment {
  context: TestRunContext;
  lease: DataStackLease;
  seededInput?: string;
  dockerStartedAt: string;
}

/** The lease remains test-only; every writer holds this lock for the whole task. */
export async function withTestEnvironment<T>(
  work: (environment: NodeJS.ProcessEnv, context: TestRunContext) => Promise<T>,
  options: { seed?: boolean; clean?: boolean } = {},
): Promise<T | undefined> {
  const release = await acquireLock("test-database");
  try {
    let saved = await readJson<SharedEnvironment>(path);
    if (saved && saved.context.workspaceRoot !== process.cwd())
      throw new Error("Shared test lease belongs to another workspace.");
    if (saved) {
      const output = await execute("docker", [
        "ps",
        "-q",
        "--filter",
        `label=com.docker.compose.project=${saved.lease.composeProject}`,
        "--filter",
        "label=com.docker.compose.service=postgres",
      ]).then((result) => result.stdout.trim());
      const startedAt = output
        ? await execute("docker", [
            "inspect",
            "--format",
            "{{.State.StartedAt}}",
            output,
          ]).then((result) => result.stdout.trim())
        : "";
      // tmpfs disappears when Docker restarts. Replace only this exact recorded lease.
      if (options.clean || !startedAt || startedAt !== saved.dockerStartedAt) {
        await destroyDataStack(saved.lease);
        saved = null;
        await writeJson(path, null);
      }
    }
    if (options.clean) return;
    if (!saved) {
      const context = await createTestRunContext("integration");
      const lease = await provisionDataStack({
        environment: "test",
        runId: context.runId,
        hostPort: context.databasePort,
        onProgress: console.log,
      });
      const container = (
        await execute("docker", [
          "ps",
          "-q",
          "--filter",
          `label=com.docker.compose.project=${lease.composeProject}`,
          "--filter",
          "label=com.docker.compose.service=postgres",
        ])
      ).stdout.trim();
      const dockerStartedAt = (
        await execute("docker", [
          "inspect",
          "--format",
          "{{.State.StartedAt}}",
          container,
        ])
      ).stdout.trim();
      saved = { context, lease, dockerStartedAt };
      await writeJson(path, saved);
    }
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
      NEXT_DIST_DIR: relative(process.cwd(), context.nextDistDirectory),
      MEDOTA2_NEXT_TSCONFIG: relative(process.cwd(), context.nextTsconfigPath),
    };
    const fromRun = relative(context.runRoot, process.cwd());
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
    await run("pnpm", ["exec", "tsx", "src/workers/migrate-test.ts"], {
      ...env,
      MEDOTA2_PROCESS_ROLE: "migration",
    });
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
    if (options.seed && saved.seededInput !== seedInput) {
      await run(
        "pnpm",
        [
          "exec",
          "tsx",
          "tests/helpers/seed-test-database.ts",
          "--include-large-list",
        ],
        { ...env, MEDOTA2_PROCESS_ROLE: "migration" },
      );
      saved.seededInput = seedInput;
      await writeJson(path, saved);
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
      return await work(env, context);
    } catch (error) {
      evidence.status = "failed";
      throw error;
    } finally {
      // Destructive checks can change fixture content, including on failure.
      if (!options.seed || evidence.status === "failed") {
        delete saved.seededInput;
        await writeJson(path, saved);
      }
      await writeJson(resolve(runRoot, "run.json"), {
        ...evidence,
        status: evidence.status === "running" ? "passed" : evidence.status,
        finishedAt: new Date().toISOString(),
      });
    }
  } finally {
    await release();
  }
}
