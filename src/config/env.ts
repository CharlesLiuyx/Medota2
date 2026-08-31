import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";
import {
  DATA_CLASSES,
  DEFAULT_DATA_CLASS,
  DATABASE_ROLE_NAMES_BY_ENVIRONMENT,
  RUNTIME_ENVIRONMENTS,
  type DatabaseRole,
  type EnvironmentDeclaration,
  type RuntimeEnvironment,
} from "@/domain/environment";
import { getLocalEnvironmentReceiptIdentity } from "./environment-receipt";
import { getLocalDatabaseCredentialUrl } from "./database-credentials";

let loaded = false;
let declaredEnvironment: EnvironmentDeclaration | null = null;
let localEnvValues: Record<string, string | undefined> = {};

export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;

  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    localEnvValues = parseEnv(readFileSync(envPath, "utf8"));
    for (const [key, value] of Object.entries(localEnvValues)) {
      if (value === undefined) continue;
      if (isDatabaseSecretKey(key)) {
        // Next.js may already have loaded .env. Local database credentials are
        // intentionally supplied by the private provisioning receipt instead.
        if (process.env[key] === value) delete process.env[key];
        delete localEnvValues[key];
        continue;
      }
      process.env[key] ??= value;
    }
  }
}

const databaseUrl = z.string().url().startsWith("postgresql://");
const runtimeEnvironment = z.enum(RUNTIME_ENVIRONMENTS);
const dataClass = z.enum(DATA_CLASSES);
const uuid = z.uuid();
const postgresSystemIdentifier = z.string().regex(/^[0-9]{1,20}$/u);
const runId = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u);

const DATABASE_URL_SUFFIX: Readonly<Record<RuntimeEnvironment, string>> = {
  development: "",
  test: "_TEST",
  "local-review": "_LOCAL",
  production: "_PRODUCTION",
};

export function getEnvironmentDeclaration(): EnvironmentDeclaration {
  if (declaredEnvironment) return declaredEnvironment;
  loadLocalEnv();
  const environmentResult = runtimeEnvironment.safeParse(
    configurationValue("MEDOTA2_ENVIRONMENT"),
  );
  if (!environmentResult.success) {
    throw new Error(
      "MEDOTA2_ENVIRONMENT is required and must be development, test, local-review, or production.",
    );
  }
  const environment = environmentResult.data;
  const dataClassResult = dataClass.safeParse(
    configurationValue("MEDOTA2_DATA_CLASS"),
  );
  if (!dataClassResult.success) {
    throw new Error(
      "MEDOTA2_DATA_CLASS is required and must be sandbox, synthetic-fixture, production-snapshot, or live-production.",
    );
  }
  if (dataClassResult.data !== DEFAULT_DATA_CLASS[environment]) {
    throw new Error(
      "MEDOTA2_DATA_CLASS=" +
        dataClassResult.data +
        " is not allowed for " +
        environment +
        "; expected " +
        DEFAULT_DATA_CLASS[environment] +
        ".",
    );
  }
  const parsedRunId = optionalParsedValue(
    "MEDOTA2_RUN_ID",
    configurationValue("MEDOTA2_RUN_ID"),
    runId,
  );
  let expectedInstanceId = optionalParsedValue(
    "MEDOTA2_EXPECTED_INSTANCE_ID",
    configurationValue("MEDOTA2_EXPECTED_INSTANCE_ID"),
    uuid,
  );
  let expectedDatabaseId = optionalParsedValue(
    "MEDOTA2_EXPECTED_DATABASE_ID",
    configurationValue("MEDOTA2_EXPECTED_DATABASE_ID"),
    uuid,
  );
  let expectedPostgresSystemIdentifier = optionalParsedValue(
    "MEDOTA2_EXPECTED_POSTGRES_SYSTEM_IDENTIFIER",
    configurationValue("MEDOTA2_EXPECTED_POSTGRES_SYSTEM_IDENTIFIER"),
    postgresSystemIdentifier,
  );
  const expectedIdentityPartCount = [
    expectedInstanceId,
    expectedDatabaseId,
    expectedPostgresSystemIdentifier,
  ].filter(Boolean).length;
  if (expectedIdentityPartCount !== 0 && expectedIdentityPartCount !== 3) {
    throw new Error(
      "MEDOTA2_EXPECTED_INSTANCE_ID, MEDOTA2_EXPECTED_DATABASE_ID, and MEDOTA2_EXPECTED_POSTGRES_SYSTEM_IDENTIFIER must be set together.",
    );
  }
  if (environment === "production" && !expectedInstanceId) {
    throw new Error(
      "Production requires the expected instance UUID, database UUID, and PostgreSQL system identifier.",
    );
  }
  if (environment !== "production") {
    const receipt = getLocalEnvironmentReceiptIdentity(environment);
    if (!receipt) {
      throw new Error(
        "The local environment identity receipt is missing. Run pnpm db:environment:adopt:local-stack with its exact confirmation.",
      );
    }
    if (
      (expectedInstanceId && expectedInstanceId !== receipt.instanceId) ||
      (expectedDatabaseId && expectedDatabaseId !== receipt.databaseId) ||
      (expectedPostgresSystemIdentifier &&
        expectedPostgresSystemIdentifier !== receipt.postgresSystemIdentifier)
    ) {
      throw new Error(
        "Configured expected database identity conflicts with the local provisioning receipt.",
      );
    }
    expectedInstanceId = receipt.instanceId;
    expectedDatabaseId = receipt.databaseId;
    expectedPostgresSystemIdentifier = receipt.postgresSystemIdentifier;
  }
  declaredEnvironment = Object.freeze({
    contractVersion: 1,
    environment,
    dataClass: dataClassResult.data,
    runId: parsedRunId,
    expectedInstanceId,
    expectedDatabaseId,
    expectedPostgresSystemIdentifier,
  });
  return declaredEnvironment;
}

export function getEnvironmentDatabaseUrl(
  role: DatabaseRole,
  environment: RuntimeEnvironment,
): string {
  loadLocalEnv();
  if (environment !== "production") {
    const localUrl = getLocalDatabaseCredentialUrl(environment, role);
    if (!localUrl) {
      throw new Error(
        "The private local database credential receipt is missing. Run pnpm db:environment:adopt:local-stack with its exact confirmation.",
      );
    }
    return localUrl;
  }
  const suffix = DATABASE_URL_SUFFIX[environment];
  const key = "DATABASE_URL_" + role.toUpperCase() + suffix;
  const parsed = databaseUrl.safeParse(process.env[key]);
  if (!parsed.success) {
    throw new Error(
      key +
        " is required and must be a postgresql:// URL. Copy .env.example to .env.",
    );
  }
  return parsed.data;
}

export function getExpectedDatabaseRoleName(role: DatabaseRole): string {
  const environment = getEnvironmentDeclaration().environment;
  loadLocalEnv();
  const key = "MEDOTA2_DATABASE_ROLE_" + role.toUpperCase();
  const configured = configurationValue(key)?.trim();
  if (!configured) return DATABASE_ROLE_NAMES_BY_ENVIRONMENT[environment][role];
  if (!/^[a-z_][a-z0-9_-]{0,62}$/u.test(configured)) {
    throw new Error(key + " is not a valid PostgreSQL role name.");
  }
  return configured;
}

export function getDatabaseConfirmation(): string | undefined {
  loadLocalEnv();
  return (
    configurationValue("MEDOTA2_DATABASE_CONFIRMATION")?.trim() || undefined
  );
}

export function getRequiredPath(
  key: "DOTA_VPK_UPDATES_PATH" | "DOTACONSTANTS_PATH",
): string {
  loadLocalEnv();
  const value = configurationValue(key)?.trim();
  if (!value) {
    throw new Error(
      key +
        " is required. Configure it in .env; source paths are never hard-coded.",
    );
  }
  return resolve(process.cwd(), value);
}

export function getOptionalPath(
  key: "DOTA_VALVE_ASSET_PATH" | "DOTA_VPK_PATH" | "SOURCE2VIEWER_CLI_PATH",
): string | null {
  loadLocalEnv();
  const value = configurationValue(key)?.trim();
  return value ? resolve(process.cwd(), value) : null;
}

export function getOptionalValue(
  key: "DOTA_VALVE_ASSET_CLIENT_VERSION" | "CATALOG_NOTIFICATION_WEBHOOK_URL",
): string | null {
  loadLocalEnv();
  return configurationValue(key)?.trim() || null;
}

export function assertProcessMayUseDatabaseRole(role: DatabaseRole): void {
  loadLocalEnv();
  const processRole = configurationValue("MEDOTA2_PROCESS_ROLE")?.trim();
  if (processRole !== "control" && processRole !== role) {
    throw new Error(
      "MEDOTA2_PROCESS_ROLE must equal " +
        role +
        " (or control for an explicit control-plane command).",
    );
  }
}

function optionalParsedValue<T>(
  key: string,
  value: string | undefined,
  schema: z.ZodType<T>,
): T | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = schema.safeParse(trimmed);
  if (!parsed.success) throw new Error(key + " is invalid.");
  return parsed.data;
}

function configurationValue(key: string): string | undefined {
  loadLocalEnv();
  return process.env[key] ?? localEnvValues[key];
}

function isDatabaseSecretKey(key: string): boolean {
  return (
    (key.startsWith("DATABASE_URL_") && !key.endsWith("_PRODUCTION")) ||
    key === "MEDOTA2_BOOTSTRAP_DATABASE_URL" ||
    key === "MEDOTA2_POSTGRES_BOOTSTRAP_PASSWORD"
  );
}
