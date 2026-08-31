import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { relative, resolve } from "node:path";
import {
  DataStackProvisionError,
  destroyDataStack,
  provisionDataStack,
  type DataStackLease,
} from "@/server/environment/data-stack-lifecycle";

export type TestRunSuite = "integration" | "e2e" | "verify";
type RunStatus =
  "created" | "provisioning" | "running" | "passed" | "failed" | "interrupted";
type StepStatus = "running" | "passed" | "failed" | "skipped";
const allocatedWebPorts = new Set<number>();

interface VerificationStep {
  name: string;
  command: string;
  args: string[];
  status: StepStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  exitCode: number | null;
  log: string;
}

interface DatabaseEvidence {
  schemaVersion: 1;
  environment: "test";
  dataClass: "synthetic-fixture";
  databaseName: string;
  databaseFingerprint: string;
  runId: string;
  postgresVersion: string;
  migrations: Array<{ migration_id: string; file_sha256: string }>;
  catalogHeads: Array<{ dataset_key: string; version_id: string }>;
  assetHeads: Array<{
    catalog_version_id: string;
    asset_version_id: string;
  }>;
  counts: {
    heroes: number;
    abilities: number;
    catalog_versions: number;
    asset_versions: number;
  };
  publicSchemaSha256: string;
}

interface VerificationManifest {
  schemaVersion: 1;
  runId: string;
  suite: TestRunSuite;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  workspace: {
    gitCommit: string | null;
    dirty: boolean | null;
    node: string;
    pnpm: string | null;
    playwright: string | null;
  };
  resources: {
    composeProject: string;
    databaseHostPort: number | null;
    webOrigin: string;
    stateDirectory: string;
    nextDistDirectory: string;
    nextTsconfig: string;
    artifactRoot: string;
    networkPolicy: "loopback-only";
  };
  steps: VerificationStep[];
  databaseEvidence: {
    before: DatabaseEvidence | null;
    after: DatabaseEvidence | null;
  };
  cleanup: {
    status: "not-required" | "pending" | "cleaned" | "retained" | "failed";
    databaseRetained: boolean;
    detail: string | null;
  };
}

export interface TestRunContext {
  runId: string;
  suite: TestRunSuite;
  workspaceRoot: string;
  runRoot: string;
  stateDirectory: string;
  artifactRoot: string;
  nextDistDirectory: string;
  nextTsconfigPath: string;
  databasePort: number;
  webPort: number;
  webOrigin: string;
  composeProject: string;
}

export interface TestRunOptions {
  faultAfterProvision?: boolean;
}

interface ChildStepResult {
  stdout: string;
  stderr: string;
}

class StepFailure extends Error {
  constructor(
    readonly stepName: string,
    readonly exitCode: number | null,
  ) {
    super(
      `Verification step ${stepName} failed${exitCode === null ? "" : ` with exit code ${exitCode}`}.`,
    );
    this.name = "StepFailure";
  }
}

export async function runTestSuite(
  suite: TestRunSuite,
  options: TestRunOptions = {},
): Promise<string> {
  const context = await createTestRunContext(suite);
  await mkdir(resolve(context.runRoot, "logs"), {
    recursive: true,
    mode: 0o700,
  });
  const manifest = await createManifest(context);
  await persistManifest(context, manifest);

  let lease: DataStackLease | null = null;
  let activeChild: ChildProcess | null = null;
  let interrupted = false;
  let signalCount = 0;
  let runError: unknown;
  const onSignal = (): void => {
    signalCount += 1;
    interrupted = true;
    if (signalCount > 1) {
      process.exit(130);
    }
    activeChild?.kill("SIGTERM");
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  const runStep = async (
    name: string,
    command: string,
    args: readonly string[],
    environment: NodeJS.ProcessEnv,
  ): Promise<ChildStepResult> => {
    const step = startStep(manifest, name, command, args, context);
    await persistManifest(context, manifest);
    const logPath = resolve(context.runRoot, step.log);
    const log = createWriteStream(logPath, { flags: "wx", mode: 0o600 });
    const started = Date.now();
    let stdout = "";
    let stderr = "";
    try {
      const child = spawn(command, [...args], {
        cwd: context.workspaceRoot,
        env: environment,
        stdio: ["ignore", "pipe", "pipe"],
      });
      activeChild = child;
      child.stdout?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdout = appendCaptured(stdout, text);
        log.write(text);
        process.stdout.write(text);
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderr = appendCaptured(stderr, text);
        log.write(text);
        process.stderr.write(text);
      });
      const exitCode = await new Promise<number | null>(
        (resolveExit, reject) => {
          child.once("error", reject);
          child.once("close", resolveExit);
        },
      );
      finishStep(step, exitCode === 0 ? "passed" : "failed", exitCode, started);
      await persistManifest(context, manifest);
      if (exitCode !== 0) throw new StepFailure(name, exitCode);
      return { stdout, stderr };
    } catch (error) {
      if (step.status === "running") {
        finishStep(step, "failed", null, started);
        await persistManifest(context, manifest);
      }
      throw error;
    } finally {
      activeChild = null;
      log.end();
    }
  };

  try {
    await writeRunNextTsconfig(context);
    manifest.status = "running";
    await persistManifest(context, manifest);

    if (suite === "verify") {
      const baseEnvironment = {
        ...process.env,
        CI: process.env.CI ?? "true",
      };
      await runStep(
        "format-check",
        "pnpm",
        ["exec", "prettier", "--check", "."],
        baseEnvironment,
      );
      await runStep("lint", "pnpm", ["exec", "eslint", "."], baseEnvironment);
      await runStep(
        "typecheck",
        "pnpm",
        ["exec", "tsc", "--noEmit"],
        baseEnvironment,
      );
      await runStep(
        "unit-coverage",
        "pnpm",
        ["exec", "vitest", "run", "--coverage"],
        {
          ...baseEnvironment,
          MEDOTA2_COVERAGE_DIRECTORY: resolve(context.artifactRoot, "coverage"),
          MEDOTA2_ENVIRONMENT: "development",
          MEDOTA2_DATA_CLASS: "sandbox",
        },
      );
    }

    manifest.status = "provisioning";
    manifest.cleanup.status = "pending";
    await persistManifest(context, manifest);
    lease = await recordProvisionStep(context, manifest);
    manifest.resources.databaseHostPort = lease.hostPort;
    manifest.status = "running";
    await persistManifest(context, manifest);

    const testEnvironment = buildTestEnvironment(context);
    if (options.faultAfterProvision) {
      throw new Error("Injected Test Run Harness failure after provisioning");
    }
    await runStep(
      "migrate-test",
      "pnpm",
      ["exec", "tsx", "src/workers/migrate-test.ts"],
      { ...testEnvironment, MEDOTA2_PROCESS_ROLE: "migration" },
    );
    const beforeEvidenceResult = await runStep(
      "database-evidence-before",
      "pnpm",
      ["exec", "tsx", "src/workers/capture-verification-evidence.ts"],
      { ...testEnvironment, MEDOTA2_PROCESS_ROLE: "web" },
    );
    manifest.databaseEvidence.before = parseDatabaseEvidence(
      beforeEvidenceResult.stdout,
      context.runId,
    );
    await persistManifest(context, manifest);

    if (suite === "integration" || suite === "verify") {
      await runStep(
        "integration",
        "pnpm",
        ["exec", "vitest", "run", "--config", "vitest.integration.config.ts"],
        { ...testEnvironment, MEDOTA2_PROCESS_ROLE: "control" },
      );
    }

    if (suite === "e2e" || suite === "verify") {
      await runStep(
        "seed-e2e",
        "pnpm",
        [
          "exec",
          "tsx",
          "tests/helpers/seed-test-database.ts",
          "--include-large-list",
        ],
        { ...testEnvironment, MEDOTA2_PROCESS_ROLE: "migration" },
      );
    }

    if (suite === "verify") {
      await runStep(
        "production-build",
        "pnpm",
        ["exec", "next", "build", "--webpack"],
        { ...testEnvironment, MEDOTA2_PROCESS_ROLE: "web" },
      );
      await runProductionSmoke(context, manifest, testEnvironment, (child) => {
        activeChild = child;
      });
      activeChild = null;
    }

    if (suite === "e2e" || suite === "verify") {
      await runStep("e2e", "pnpm", ["exec", "playwright", "test"], {
        ...testEnvironment,
        MEDOTA2_PROCESS_ROLE: "control",
      });
    }

    const evidenceResult = await runStep(
      "database-evidence-after",
      "pnpm",
      ["exec", "tsx", "src/workers/capture-verification-evidence.ts"],
      { ...testEnvironment, MEDOTA2_PROCESS_ROLE: "web" },
    );
    manifest.databaseEvidence.after = parseDatabaseEvidence(
      evidenceResult.stdout,
      context.runId,
    );
    manifest.status = interrupted ? "interrupted" : "passed";
  } catch (error) {
    runError = error;
    manifest.status = interrupted ? "interrupted" : "failed";
    if (!lease && error instanceof DataStackProvisionError) {
      manifest.cleanup = {
        status:
          error.cleanupStatus === "cleaned"
            ? "cleaned"
            : error.cleanupStatus === "failed"
              ? "failed"
              : "not-required",
        databaseRetained: error.cleanupStatus === "failed",
        detail:
          error.cleanupStatus === "failed"
            ? `Exact Compose project may remain: ${context.composeProject}`
            : null,
      };
    }
    await persistManifest(context, manifest);
  } finally {
    manifest.finishedAt = new Date().toISOString();
    if (lease) {
      const retain =
        manifest.status !== "passed" &&
        process.env.MEDOTA2_KEEP_FAILED_TEST_RUN === "1";
      if (retain) {
        manifest.cleanup = {
          status: "retained",
          databaseRetained: true,
          detail: `Exact Compose project retained: ${lease.composeProject}`,
        };
      } else {
        try {
          await destroyDataStack(lease, context.workspaceRoot);
          await Promise.all([
            rm(context.stateDirectory, { recursive: true, force: true }),
            rm(context.nextDistDirectory, { recursive: true, force: true }),
          ]);
          manifest.cleanup = {
            status: "cleaned",
            databaseRetained: false,
            detail: null,
          };
        } catch (cleanupError) {
          manifest.cleanup = {
            status: "failed",
            databaseRetained: true,
            detail:
              cleanupError instanceof Error
                ? cleanupError.message
                : "Unknown cleanup failure.",
          };
          if (manifest.status === "passed") manifest.status = "failed";
        }
      }
    }
    await persistManifest(context, manifest);
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }

  if (manifest.status !== "passed" || manifest.cleanup.status === "failed") {
    const detail = runError instanceof Error ? `: ${runError.message}` : "";
    throw new Error(
      `Test run ${context.runId} did not complete successfully${detail}; see ${resolve(context.runRoot, "index.md")}.`,
      { cause: runError },
    );
  }
  return context.runRoot;
}

export async function createTestRunContext(
  suite: TestRunSuite,
  workspaceRoot = process.cwd(),
  assignedWebPort?: number,
  assignedDatabasePort?: number,
): Promise<TestRunContext> {
  if (!(["integration", "e2e", "verify"] as const).includes(suite)) {
    throw new Error("Unsupported test run suite.");
  }
  const root = resolve(workspaceRoot);
  const runId = createRunId(suite);
  const runRoot = resolve(root, ".medota2", "test-runs", runId);
  if (
    assignedWebPort !== undefined &&
    (!Number.isInteger(assignedWebPort) ||
      assignedWebPort < 1 ||
      assignedWebPort > 65535)
  ) {
    throw new Error("Assigned Test Run Web port is invalid.");
  }
  const webPort = assignedWebPort ?? (await reserveAvailablePort());
  if (
    assignedDatabasePort !== undefined &&
    (!Number.isInteger(assignedDatabasePort) ||
      assignedDatabasePort < 1 ||
      assignedDatabasePort > 65535 ||
      assignedDatabasePort === webPort)
  ) {
    throw new Error("Assigned Test Run database port is invalid.");
  }
  const databasePort = assignedDatabasePort ?? (await reserveAvailablePort());
  return {
    runId,
    suite,
    workspaceRoot: root,
    runRoot,
    stateDirectory: resolve(runRoot, "state"),
    artifactRoot: resolve(runRoot, "artifacts"),
    nextDistDirectory: resolve(runRoot, "next"),
    nextTsconfigPath: resolve(runRoot, "tsconfig.next.json"),
    databasePort,
    webPort,
    webOrigin: `http://127.0.0.1:${webPort}`,
    composeProject: `medota2-test-${runId}`,
  };
}

export function createRunId(
  suite: TestRunSuite,
  date = new Date(),
  entropy = randomBytes(4).toString("hex"),
): string {
  const timestamp = date
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "z")
    .toLowerCase();
  const normalizedEntropy = entropy.toLowerCase();
  if (!/^[a-f0-9]{8}$/u.test(normalizedEntropy)) {
    throw new Error(
      "Run Identity entropy must be eight hexadecimal characters.",
    );
  }
  return `${suite}-${timestamp}-${normalizedEntropy}`;
}

async function createManifest(
  context: TestRunContext,
): Promise<VerificationManifest> {
  const [gitCommit, gitDirty, pnpmVersion, playwrightVersion] =
    await Promise.all([
      readMetadataCommand(context.workspaceRoot, "git", ["rev-parse", "HEAD"]),
      readMetadataCommand(context.workspaceRoot, "git", [
        "status",
        "--porcelain",
      ]),
      readMetadataCommand(context.workspaceRoot, "pnpm", ["--version"]),
      readMetadataCommand(context.workspaceRoot, "pnpm", [
        "exec",
        "playwright",
        "--version",
      ]),
    ]);
  return {
    schemaVersion: 1,
    runId: context.runId,
    suite: context.suite,
    status: "created",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    workspace: {
      gitCommit: gitCommit || null,
      dirty: gitDirty === null ? null : gitDirty.length > 0,
      node: process.version,
      pnpm: pnpmVersion || null,
      playwright: playwrightVersion || null,
    },
    resources: {
      composeProject: context.composeProject,
      databaseHostPort: null,
      webOrigin: context.webOrigin,
      stateDirectory: relative(context.runRoot, context.stateDirectory),
      nextDistDirectory: relative(context.runRoot, context.nextDistDirectory),
      nextTsconfig: relative(context.runRoot, context.nextTsconfigPath),
      artifactRoot: relative(context.runRoot, context.artifactRoot),
      networkPolicy: "loopback-only",
    },
    steps: [],
    databaseEvidence: { before: null, after: null },
    cleanup: {
      status: "not-required",
      databaseRetained: false,
      detail: null,
    },
  };
}

async function recordProvisionStep(
  context: TestRunContext,
  manifest: VerificationManifest,
): Promise<DataStackLease> {
  const step = startStep(
    manifest,
    "provision-test-stack",
    "internal:data-stack-lifecycle",
    [context.composeProject],
    context,
  );
  const started = Date.now();
  const logPath = resolve(context.runRoot, step.log);
  const messages: string[] = [];
  try {
    const lease = await provisionDataStack({
      environment: "test",
      runId: context.runId,
      hostPort: context.databasePort,
      workspaceRoot: context.workspaceRoot,
      onProgress: (message) => {
        messages.push(message);
        process.stdout.write(message + "\n");
      },
    });
    await writeFile(logPath, messages.join("\n") + "\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    finishStep(step, "passed", 0, started);
    await persistManifest(context, manifest);
    return lease;
  } catch (error) {
    messages.push(error instanceof Error ? error.message : String(error));
    await writeFile(logPath, messages.join("\n") + "\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    }).catch(() => undefined);
    finishStep(step, "failed", 1, started);
    await persistManifest(context, manifest);
    throw error;
  }
}

async function runProductionSmoke(
  context: TestRunContext,
  manifest: VerificationManifest,
  environment: NodeJS.ProcessEnv,
  setActiveChild: (child: ChildProcess | null) => void,
): Promise<void> {
  const name = "production-start-smoke";
  const args = [
    "exec",
    "next",
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    String(context.webPort),
  ];
  const step = startStep(manifest, name, "pnpm", args, context);
  await persistManifest(context, manifest);
  const started = Date.now();
  const log = createWriteStream(resolve(context.runRoot, step.log), {
    flags: "wx",
    mode: 0o600,
  });
  const child = spawn("pnpm", args, {
    cwd: context.workspaceRoot,
    env: { ...environment, MEDOTA2_PROCESS_ROLE: "web" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  setActiveChild(child);
  child.stdout?.on("data", (chunk: Buffer) => {
    log.write(chunk);
    process.stdout.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    log.write(chunk);
    process.stderr.write(chunk);
  });

  try {
    await waitForVerifiedWeb(context.webOrigin, context.runId, child);
    finishStep(step, "passed", 0, started);
  } catch (error) {
    finishStep(step, "failed", child.exitCode, started);
    throw error;
  } finally {
    child.kill("SIGTERM");
    await waitForChildClose(child, 10_000);
    setActiveChild(null);
    log.end();
    await persistManifest(context, manifest);
  }
}

async function waitForVerifiedWeb(
  origin: string,
  runId: string,
  child: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next production server exited with ${child.exitCode}.`);
    }
    try {
      const response = await fetch(
        `${origin}/api/catalog/heroes?q=__medota2_verify_smoke__`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (
        response.ok &&
        response.headers.get("x-medota2-environment") === "test" &&
        response.headers.get("x-medota2-data-class") === "synthetic-fixture" &&
        response.headers.get("x-medota2-run-id") === runId &&
        response.headers.get("x-medota2-environment-verification") ===
          "verified"
      ) {
        return;
      }
      lastError = new Error(`Unexpected smoke response ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error("Timed out waiting for a verified production-build smoke.", {
    cause: lastError,
  });
}

function buildTestEnvironment(context: TestRunContext): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CI: process.env.CI ?? "true",
    MEDOTA2_ENVIRONMENT: "test",
    MEDOTA2_DATA_CLASS: "synthetic-fixture",
    MEDOTA2_RUN_ID: context.runId,
    MEDOTA2_STATE_DIRECTORY: relative(
      context.workspaceRoot,
      context.stateDirectory,
    ),
    MEDOTA2_ARTIFACT_ROOT: context.artifactRoot,
    MEDOTA2_TEST_WEB_PORT: String(context.webPort),
    MEDOTA2_NETWORK_POLICY: "loopback-only",
    MEDOTA2_NEXT_TSCONFIG: relative(
      context.workspaceRoot,
      context.nextTsconfigPath,
    ),
    NEXT_DIST_DIR: relative(context.workspaceRoot, context.nextDistDirectory),
  };
}

async function writeRunNextTsconfig(context: TestRunContext): Promise<void> {
  const workspaceFromRun = relative(context.runRoot, context.workspaceRoot);
  const fromWorkspace = (path: string): string => `${workspaceFromRun}/${path}`;
  const config = {
    extends: fromWorkspace("tsconfig.json"),
    include: [
      fromWorkspace("next-env.d.ts"),
      fromWorkspace("src/**/*.ts"),
      fromWorkspace("src/**/*.tsx"),
      "next/types/**/*.ts",
      "next/dev/types/**/*.ts",
    ],
    exclude: [fromWorkspace("node_modules")],
  };
  await writeFile(
    context.nextTsconfigPath,
    JSON.stringify(config, null, 2) + "\n",
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

function startStep(
  manifest: VerificationManifest,
  name: string,
  command: string,
  args: readonly string[],
  context: TestRunContext,
): VerificationStep {
  const log = relative(
    context.runRoot,
    resolve(
      context.runRoot,
      "logs",
      `${String(manifest.steps.length + 1).padStart(2, "0")}-${name}.log`,
    ),
  );
  const step: VerificationStep = {
    name,
    command,
    args: [...args],
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    exitCode: null,
    log,
  };
  manifest.steps.push(step);
  return step;
}

function finishStep(
  step: VerificationStep,
  status: Extract<StepStatus, "passed" | "failed">,
  exitCode: number | null,
  started: number,
): void {
  step.status = status;
  step.exitCode = exitCode;
  step.finishedAt = new Date().toISOString();
  step.durationMs = Date.now() - started;
}

async function persistManifest(
  context: TestRunContext,
  manifest: VerificationManifest,
): Promise<void> {
  await mkdir(context.runRoot, { recursive: true, mode: 0o700 });
  await mkdir(context.artifactRoot, { recursive: true, mode: 0o700 });
  const path = resolve(context.runRoot, "run.json");
  const temporary = resolve(context.runRoot, `.run.${process.pid}.tmp`);
  await writeFile(temporary, JSON.stringify(manifest, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
  await writeFile(
    resolve(context.runRoot, "index.md"),
    renderManifestIndex(manifest),
    { encoding: "utf8", mode: 0o600 },
  );
}

function renderManifestIndex(manifest: VerificationManifest): string {
  const lines = [
    `# Medota2 verification run ${manifest.runId}`,
    "",
    `- Suite: \`${manifest.suite}\``,
    `- Status: \`${manifest.status}\``,
    `- Started: ${manifest.startedAt}`,
    `- Finished: ${manifest.finishedAt ?? "in progress"}`,
    `- Environment: \`test / synthetic-fixture\``,
    `- Network: \`${manifest.resources.networkPolicy}\``,
    `- Toolchain: Node \`${manifest.workspace.node}\`, pnpm \`${manifest.workspace.pnpm ?? "unknown"}\`, Playwright \`${manifest.workspace.playwright ?? "unknown"}\``,
    `- Compose project: \`${manifest.resources.composeProject}\``,
    `- Cleanup: \`${manifest.cleanup.status}\``,
    "",
    "## Steps",
    "",
    "| Step | Status | Duration (ms) | Exit | Log |",
    "| --- | --- | ---: | ---: | --- |",
    ...manifest.steps.map(
      (step) =>
        `| ${step.name} | ${step.status} | ${step.durationMs ?? ""} | ${step.exitCode ?? ""} | [log](${step.log}) |`,
    ),
    "",
    "## Database evidence",
    "",
    manifest.databaseEvidence.after
      ? `- Database: \`${manifest.databaseEvidence.after.databaseName}\` / \`${manifest.databaseEvidence.after.databaseFingerprint}\`\n- PostgreSQL: \`${manifest.databaseEvidence.after.postgresVersion}\`\n- Public schema SHA-256: \`${manifest.databaseEvidence.after.publicSchemaSha256}\`\n- Before Heroes / Abilities: ${manifest.databaseEvidence.before?.counts.heroes ?? "unknown"} / ${manifest.databaseEvidence.before?.counts.abilities ?? "unknown"}\n- After Heroes / Abilities: ${manifest.databaseEvidence.after.counts.heroes} / ${manifest.databaseEvidence.after.counts.abilities}`
      : "No database evidence has been captured yet.",
    "",
    "The machine-readable source of truth is [run.json](run.json).",
    "",
  ];
  return lines.join("\n");
}

function parseDatabaseEvidence(
  stdout: string,
  runId: string,
): DatabaseEvidence {
  const lines = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = JSON.parse(lines.at(-1) ?? "null") as DatabaseEvidence | null;
  if (
    !parsed ||
    parsed.schemaVersion !== 1 ||
    parsed.environment !== "test" ||
    parsed.dataClass !== "synthetic-fixture" ||
    parsed.runId !== runId ||
    !parsed.postgresVersion ||
    !/^[0-9a-f]{64}$/u.test(parsed.publicSchemaSha256)
  ) {
    throw new Error("Database evidence did not match the active Test Run.");
  }
  return parsed;
}

async function readMetadataCommand(
  cwd: string,
  command: string,
  args: readonly string[],
): Promise<string | null> {
  return new Promise((resolveResult) => {
    const child = spawn(command, [...args], {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output = appendCaptured(output, chunk.toString("utf8"));
    });
    child.once("error", () => resolveResult(null));
    child.once("close", (code) =>
      resolveResult(code === 0 ? output.trim() : null),
    );
  });
}

async function reserveAvailablePort(): Promise<number> {
  const port = await new Promise<number>((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Failed to allocate a Web port."));
        else resolvePort(port);
      });
    });
  });
  if (allocatedWebPorts.has(port)) return reserveAvailablePort();
  allocatedWebPorts.add(port);
  return port;
}

async function waitForChildClose(
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>((resolveClose) =>
      child.once("close", () => resolveClose()),
    ),
    new Promise<void>((resolveTimeout) =>
      setTimeout(() => {
        child.kill("SIGKILL");
        resolveTimeout();
      }, timeoutMs),
    ),
  ]);
}

function appendCaptured(current: string, addition: string): string {
  const next = current + addition;
  return next.length <= 2_000_000 ? next : next.slice(-2_000_000);
}

export async function readRunManifest(
  runRoot: string,
): Promise<VerificationManifest> {
  return JSON.parse(
    await readFile(resolve(runRoot, "run.json"), "utf8"),
  ) as VerificationManifest;
}
