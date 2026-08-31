import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { relative, resolve } from "node:path";
import { createServer } from "node:net";
import { promisify } from "node:util";
import { writeLocalEnvironmentReceipt } from "@/config/environment-receipt";
import type { RuntimeEnvironment } from "@/domain/environment";
import { LOCAL_STACK_ADOPTION_CONFIRMATION } from "./adopt-local-stack";
import { isolateLocalStack } from "./isolate-local-stack";

const execFileAsync = promisify(execFile);
const MANAGED_ENVIRONMENTS = ["development", "local-review", "test"] as const;
const TEST_PROJECT_PREFIX = "medota2-test-";

type ManagedEnvironment = (typeof MANAGED_ENVIRONMENTS)[number];

export interface DataStackLease {
  contractVersion: 1;
  environment: ManagedEnvironment;
  composeProject: string;
  composeFile: string;
  stateDirectory: string;
  hostPort: number;
  persistence: "persistent" | "disposable";
}

interface ProvisionDataStackInput {
  environment: ManagedEnvironment;
  runId?: string;
  workspaceRoot?: string;
  hostPort?: number;
  onProgress?: (message: string) => void;
}

export class DataStackProvisionError extends Error {
  constructor(
    message: string,
    readonly cleanupStatus: "cleaned" | "failed" | "not-applicable",
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "DataStackProvisionError";
  }
}

export async function provisionDataStack(
  input: ProvisionDataStackInput,
): Promise<DataStackLease> {
  const workspaceRoot = resolve(input.workspaceRoot ?? process.cwd());
  const planned = createDataStackPlan({ ...input, workspaceRoot });
  const plan =
    planned.environment === "test" && planned.hostPort === 0
      ? { ...planned, hostPort: await reserveAvailablePort() }
      : planned;
  const bootstrapPassword = randomBytes(32).toString("base64url");
  const composeEnvironment = {
    ...process.env,
    MEDOTA2_POSTGRES_BOOTSTRAP_PASSWORD: bootstrapPassword,
    MEDOTA2_POSTGRES_PORT: String(plan.hostPort),
  };

  input.onProgress?.(
    `Provisioning ${plan.environment} stack ${plan.composeProject}.`,
  );
  try {
    await runCompose(
      workspaceRoot,
      plan,
      ["up", "-d", "--wait", "postgres"],
      composeEnvironment,
    );
    await adoptProvisionedStack(
      plan,
      workspaceRoot,
      bootstrapPassword,
      input.onProgress,
    );
    return plan;
  } catch (error) {
    const diagnostics = await runCompose(
      workspaceRoot,
      plan,
      ["logs", "--no-color", "--tail", "120", "postgres"],
      composeEnvironment,
    ).catch(() => "");
    let cleanupStatus: DataStackProvisionError["cleanupStatus"] =
      "not-applicable";
    let cleanupError: unknown;
    if (plan.persistence === "disposable") {
      try {
        await destroyDataStack(plan, workspaceRoot);
        cleanupStatus = "cleaned";
      } catch (caughtCleanupError) {
        cleanupStatus = "failed";
        cleanupError = caughtCleanupError;
      }
    }
    const cleanupDetail = cleanupError
      ? `\nExact-stack cleanup also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
      : "";
    throw new DataStackProvisionError(
      `${error instanceof Error ? error.message : String(error)}${diagnostics.trim() ? `\nPostgreSQL diagnostics:\n${diagnostics.trim()}` : ""}${cleanupDetail}`,
      cleanupStatus,
      cleanupError ? new AggregateError([error, cleanupError]) : error,
    );
  }
}

export async function startPersistentDataStack(
  environment: Exclude<ManagedEnvironment, "test">,
  workspaceRoot = process.cwd(),
): Promise<void> {
  const root = resolve(workspaceRoot);
  const plan = createDataStackPlan({ environment, workspaceRoot: root });
  await runCompose(root, plan, ["up", "-d", "--wait", "postgres"], {
    ...process.env,
    MEDOTA2_POSTGRES_PORT: String(plan.hostPort),
  });
}

export async function stopPersistentDataStack(
  environment: Exclude<ManagedEnvironment, "test">,
  workspaceRoot = process.cwd(),
): Promise<void> {
  const root = resolve(workspaceRoot);
  const plan = createDataStackPlan({ environment, workspaceRoot: root });
  await runCompose(root, plan, ["stop", "postgres"], {
    ...process.env,
    MEDOTA2_POSTGRES_PORT: String(plan.hostPort),
  });
}

export async function destroyDataStack(
  lease: Pick<
    DataStackLease,
    | "environment"
    | "composeProject"
    | "composeFile"
    | "hostPort"
    | "persistence"
  >,
  workspaceRoot = process.cwd(),
): Promise<void> {
  assertDisposableLease(lease);
  await runCompose(
    resolve(workspaceRoot),
    lease,
    ["down", "--volumes", "--remove-orphans", "--timeout", "10"],
    {
      ...process.env,
      MEDOTA2_POSTGRES_BOOTSTRAP_PASSWORD:
        "unused-during-exact-test-stack-cleanup",
      MEDOTA2_POSTGRES_PORT: String(lease.hostPort),
    },
  );
}

export function createDataStackPlan(
  input: Omit<ProvisionDataStackInput, "workspaceRoot"> & {
    workspaceRoot: string;
  },
): DataStackLease {
  if (!MANAGED_ENVIRONMENTS.includes(input.environment)) {
    throw new Error("Unsupported managed data stack environment.");
  }
  const workspaceRoot = resolve(input.workspaceRoot);
  if (input.environment === "test") {
    const runId = input.runId?.trim();
    if (!runId || !/^[a-z0-9][a-z0-9-]{7,62}$/u.test(runId)) {
      throw new Error(
        "A lowercase, hyphenated Run Identity is required for a disposable test stack.",
      );
    }
    const composeProject = `${TEST_PROJECT_PREFIX}${runId}`.slice(0, 63);
    return {
      contractVersion: 1,
      environment: "test",
      composeProject,
      composeFile: resolve(workspaceRoot, "docker-compose.test-run.yml"),
      stateDirectory: resolve(
        workspaceRoot,
        ".medota2",
        "test-runs",
        runId,
        "state",
      ),
      hostPort: validatedTestPort(input.hostPort),
      persistence: "disposable",
    };
  }

  const defaultPort = input.environment === "development" ? 54321 : 54322;
  const hostPort = input.hostPort ?? defaultPort;
  if (!Number.isInteger(hostPort) || hostPort < 1024 || hostPort > 65535) {
    throw new Error(
      "Persistent stack host port must be between 1024 and 65535.",
    );
  }
  return {
    contractVersion: 1,
    environment: input.environment,
    composeProject: `medota2-${input.environment}`,
    composeFile: resolve(workspaceRoot, "docker-compose.data-stack.yml"),
    stateDirectory: resolve(
      workspaceRoot,
      ".medota2",
      "environments",
      input.environment,
    ),
    hostPort,
    persistence: "persistent",
  };
}

function assertDisposableLease(
  lease: Pick<
    DataStackLease,
    | "environment"
    | "composeProject"
    | "composeFile"
    | "hostPort"
    | "persistence"
  >,
): void {
  if (
    lease.environment !== "test" ||
    lease.persistence !== "disposable" ||
    !Number.isInteger(lease.hostPort) ||
    lease.hostPort < 1024 ||
    lease.hostPort > 65535 ||
    !lease.composeProject.startsWith(TEST_PROJECT_PREFIX) ||
    !/^medota2-test-[a-z0-9][a-z0-9-]{7,62}$/u.test(lease.composeProject) ||
    !lease.composeFile.endsWith("docker-compose.test-run.yml")
  ) {
    throw new Error("Refusing to destroy a stack without an exact test lease.");
  }
}

async function adoptProvisionedStack(
  lease: DataStackLease,
  workspaceRoot: string,
  bootstrapPassword: string,
  onProgress?: (message: string) => void,
): Promise<void> {
  const previous = {
    stateDirectory: process.env.MEDOTA2_STATE_DIRECTORY,
    bootstrapUrl: process.env.MEDOTA2_BOOTSTRAP_DATABASE_URL,
    bootstrapPassword: process.env.MEDOTA2_POSTGRES_BOOTSTRAP_PASSWORD,
  };
  process.env.MEDOTA2_STATE_DIRECTORY = relative(
    workspaceRoot,
    lease.stateDirectory,
  );
  process.env.MEDOTA2_POSTGRES_BOOTSTRAP_PASSWORD = bootstrapPassword;
  process.env.MEDOTA2_BOOTSTRAP_DATABASE_URL = buildBootstrapUrl(
    bootstrapPassword,
    lease.hostPort,
  );
  try {
    const isolated = await isolateLocalStack({
      confirmation: LOCAL_STACK_ADOPTION_CONFIRMATION,
      onProgress,
    });
    writeLocalEnvironmentReceipt(isolated.receipt);
  } finally {
    restoreEnvironmentValue("MEDOTA2_STATE_DIRECTORY", previous.stateDirectory);
    restoreEnvironmentValue(
      "MEDOTA2_BOOTSTRAP_DATABASE_URL",
      previous.bootstrapUrl,
    );
    restoreEnvironmentValue(
      "MEDOTA2_POSTGRES_BOOTSTRAP_PASSWORD",
      previous.bootstrapPassword,
    );
  }
}

async function runCompose(
  workspaceRoot: string,
  plan: Pick<DataStackLease, "composeProject" | "composeFile">,
  action: readonly string[],
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const args = [
    "compose",
    "-f",
    plan.composeFile,
    "-p",
    plan.composeProject,
    ...action,
  ];
  try {
    const result = await execFileAsync("docker", args, {
      cwd: workspaceRoot,
      env: environment,
      maxBuffer: 8 * 1024 * 1024,
    });
    return result.stdout;
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new Error(
      `Docker Compose failed for exact project ${plan.composeProject}${detail ? `: ${detail}` : "."}`,
      { cause: error },
    );
  }
}

function validatedTestPort(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new Error("Test stack host port must be between 1024 and 65535.");
  }
  return value;
}

async function reserveAvailablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port)
          reject(new Error("Failed to allocate a database port."));
        else resolvePort(port);
      });
    });
  });
}

function buildBootstrapUrl(password: string, port: number): string {
  const url = new URL("postgresql://medota2_owner@127.0.0.1/medota2");
  url.password = password;
  url.port = String(port);
  return url.toString();
}

function restoreEnvironmentValue(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

export function isManagedEnvironment(
  value: string,
): value is Exclude<RuntimeEnvironment, "production"> {
  return MANAGED_ENVIRONMENTS.includes(value as ManagedEnvironment);
}
