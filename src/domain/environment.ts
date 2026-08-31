export const RUNTIME_ENVIRONMENTS = [
  "development",
  "test",
  "local-review",
  "production",
] as const;

export type RuntimeEnvironment = (typeof RUNTIME_ENVIRONMENTS)[number];

export const DATA_CLASSES = [
  "sandbox",
  "synthetic-fixture",
  "production-snapshot",
  "live-production",
] as const;

export type DataClass = (typeof DATA_CLASSES)[number];

export const DATABASE_ROLES = ["migration", "worker", "web"] as const;

export type DatabaseRole = (typeof DATABASE_ROLES)[number];

export const DATABASE_OPERATIONS = [
  "read",
  "fixture",
  "migrate",
  "import",
  "review",
  "promote",
  "rollback",
  "seed",
  "reset",
] as const;

export type DatabaseOperation = (typeof DATABASE_OPERATIONS)[number];

export type ResetPolicy =
  "manual" | "run-scoped" | "explicit-rebuild" | "never";

export interface EnvironmentDeclaration {
  contractVersion: 1;
  environment: RuntimeEnvironment;
  dataClass: DataClass;
  runId: string | null;
  expectedInstanceId: string | null;
  expectedDatabaseId: string | null;
  expectedPostgresSystemIdentifier: string | null;
}

export interface DatabaseIdentity {
  contractVersion: number;
  environment: RuntimeEnvironment;
  dataClass: DataClass;
  instanceId: string;
  databaseId: string;
  databaseName: string;
  databaseRole: DatabaseRole;
  sessionUser: string;
  endpointHost: string;
  endpointPort: number;
  serverAddress: string;
  serverPort: number;
  postgresSystemIdentifier: string;
  resetPolicy: ResetPolicy;
  runId: string | null;
  safeFingerprint: string;
}

interface PublicEnvironmentDeclaration {
  environment: RuntimeEnvironment;
  dataClass: DataClass;
  runId: string | null;
}

export type DeclaredPublicEnvironmentIdentity = PublicEnvironmentDeclaration & {
  verified: false;
  databaseName: null;
  safeFingerprint: null;
};

export type VerifiedPublicEnvironmentIdentity = PublicEnvironmentDeclaration & {
  verified: true;
  databaseName: string;
  safeFingerprint: string;
};

export type PublicEnvironmentIdentity =
  DeclaredPublicEnvironmentIdentity | VerifiedPublicEnvironmentIdentity;

export const DEFAULT_DATA_CLASS: Readonly<
  Record<RuntimeEnvironment, DataClass>
> = {
  development: "sandbox",
  test: "synthetic-fixture",
  "local-review": "production-snapshot",
  production: "live-production",
};

export const ENVIRONMENT_LABELS: Readonly<Record<RuntimeEnvironment, string>> =
  {
    development: "DEVELOPMENT",
    test: "TEST",
    "local-review": "LOCAL REVIEW",
    production: "PRODUCTION",
  };

export const DATABASE_ROLE_NAMES_BY_ENVIRONMENT: Readonly<
  Record<RuntimeEnvironment, Readonly<Record<DatabaseRole, string>>>
> = {
  development: {
    migration: "medota2_dev_migration",
    worker: "medota2_dev_worker",
    web: "medota2_dev_web",
  },
  test: {
    migration: "medota2_test_migration",
    worker: "medota2_test_worker",
    web: "medota2_test_web",
  },
  "local-review": {
    migration: "medota2_local_migration",
    worker: "medota2_local_worker",
    web: "medota2_local_web",
  },
  production: {
    migration: "medota2_prod_migration",
    worker: "medota2_prod_worker",
    web: "medota2_prod_web",
  },
};

export const CONTROL_OWNER_ROLE_NAMES_BY_ENVIRONMENT: Readonly<
  Record<RuntimeEnvironment, string>
> = {
  development: "medota2_dev_control_owner",
  test: "medota2_test_control_owner",
  "local-review": "medota2_local_control_owner",
  production: "medota2_prod_control_owner",
};
