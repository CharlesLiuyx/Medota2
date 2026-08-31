import { describe, expect, it } from "vitest";
import type {
  DataClass,
  DatabaseIdentity,
  DatabaseOperation,
  DatabaseRole,
  EnvironmentDeclaration,
  ResetPolicy,
  RuntimeEnvironment,
} from "@/domain/environment";
import { assertDatabaseIdentitiesConverge } from "@/server/environment/contract";
import {
  attestEnvironment,
  CONTROL_CONSTRAINT_SHAPE,
  CONTROL_TABLE_SHAPE,
  EnvironmentContractError,
  parseDatabaseEndpoint,
  PGCRYPTO_EXTENSION_MEMBER_SIGNATURES,
  type DatabaseProbeSnapshot,
} from "@/server/environment/policy";

describe("Environment Contract endpoint policy", () => {
  it("accepts only loopback PostgreSQL targets outside production", () => {
    expect(
      parseDatabaseEndpoint(
        "postgresql://medota2_web:secret@127.0.0.1:54321/medota2_test",
        "test",
      ),
    ).toEqual({
      hostname: "127.0.0.1",
      port: 54321,
      databaseName: "medota2_test",
      username: "medota2_web",
    });
    expectContractError(
      () =>
        parseDatabaseEndpoint(
          "postgresql://medota2_web:secret@database.example/medota2_test",
          "test",
        ),
      "ENV_URL_POLICY_VIOLATION",
    );
  });

  it("does not trust a test-looking password, query, or database suffix", () => {
    expectContractError(
      () =>
        parseDatabaseEndpoint(
          "postgresql://medota2_web:not_test@127.0.0.1/medota2?target=_test",
          "test",
        ),
      "ENV_URL_POLICY_VIOLATION",
    );
    expectContractError(
      () =>
        attestEnvironment(
          scenario({
            declaration: declaration("test"),
            endpointDatabaseName: "medota2_test",
            markerEnvironment: "development",
            markerDataClass: "sandbox",
          }),
        ),
      "ENV_TARGET_MISMATCH",
    );
  });

  it("requires verify-full TLS for a production URL", () => {
    expectContractError(
      () =>
        parseDatabaseEndpoint(
          "postgresql://medota2_web:secret@db.example/medota2",
          "production",
        ),
      "ENV_URL_POLICY_VIOLATION",
    );
    expect(
      parseDatabaseEndpoint(
        "postgresql://medota2_web:secret@db.example/medota2?sslmode=verify-full",
        "production",
      ).databaseName,
    ).toBe("medota2");
  });

  it.each([
    [
      "duplicate TLS options",
      "postgresql://medota2_web:secret@db.example/medota2?sslmode=verify-full&sslmode=disable",
    ],
    [
      "a fragment",
      "postgresql://medota2_web:secret@db.example/medota2?sslmode=verify-full#ignored",
    ],
    [
      "malformed encoding",
      "postgresql://medota2_web:secret@db.example/medota2%ZZ?sslmode=verify-full",
    ],
  ])("rejects %s instead of accepting an ambiguous URL", (_label, url) => {
    expectContractError(
      () => parseDatabaseEndpoint(url, "production"),
      "ENV_URL_POLICY_VIOLATION",
    );
  });
});

describe("Environment Contract database attestation", () => {
  it("returns only a safe verified identity for a converged target", () => {
    const identity = attestEnvironment(scenario());
    expect(identity).toMatchObject({
      environment: "development",
      dataClass: "sandbox",
      databaseName: "medota2",
      databaseRole: "web",
      safeFingerprint: "11111111-22222222",
    });
    expect(JSON.stringify(identity)).not.toContain("secret");
    expect(JSON.stringify(identity)).not.toContain("postgresql://");
  });

  it.each([
    ["URL username", { endpointUsername: "medota2_worker" }],
    ["current role", { currentUser: "medota2_owner" }],
    ["session role", { sessionUser: "medota2_owner" }],
    ["marker role", { markerRoleName: "medota2_owner" }],
  ] as const)("rejects a mismatched %s", (_label, override) => {
    expectContractError(
      () => attestEnvironment(scenario(override)),
      "ENV_ROLE_MISMATCH",
    );
  });

  it("rejects drift in a role declaration not held by the current process", () => {
    const input = scenario();
    input.probe.marker.workerRole = "unexpected_worker";
    expectContractError(() => attestEnvironment(input), "ENV_ROLE_MISMATCH");
  });

  it.each([
    ["runtime environment", { markerEnvironment: "test" }],
    ["data class", { markerDataClass: "production-snapshot" }],
    ["URL database", { endpointDatabaseName: "medota2_test" }],
    ["marker database", { markerDatabaseName: "medota2_local" }],
    ["expected instance", { expectedInstanceId: "9".repeat(36) }],
    ["expected database", { expectedDatabaseId: "8".repeat(36) }],
    [
      "expected PostgreSQL instance",
      { expectedPostgresSystemIdentifier: "9999999999999999999" },
    ],
  ] as const)("rejects a mismatched %s", (_label, override) => {
    expectContractError(
      () => attestEnvironment(scenario(override)),
      "ENV_TARGET_MISMATCH",
    );
  });

  it("rejects a missing read-only attestation boundary", () => {
    expectContractError(
      () => attestEnvironment(scenario({ transactionReadOnly: false })),
      "ENV_MARKER_INVALID",
    );
  });

  it.each([
    ["server address", { serverAddress: null }],
    ["server port", { serverPort: null }],
  ] as const)("rejects a missing %s probe", (_label, override) => {
    expectContractError(
      () => attestEnvironment(scenario(override)),
      "ENV_TARGET_MISMATCH",
    );
  });

  it.each([
    ["superuser", { roleSuperuser: true }],
    ["createdb", { roleCreateDatabase: true }],
    ["createrole", { roleCreateRole: true }],
    ["inherit", { roleInherit: true }],
    ["login disabled", { roleLogin: false }],
    ["replication", { roleReplication: true }],
    ["bypass RLS", { roleBypassRls: true }],
    ["role membership", { roleMembershipCount: 1 }],
    [
      "peer role membership",
      {
        expectedRoleMatrix: [
          "medota2_owner:false:false:false:false:true:false:false:1",
          "medota2_web:false:false:false:false:true:false:false:0",
          "medota2_worker:false:false:false:false:true:false:false:1",
        ],
      },
    ],
    ["control-marker write access", { roleHasControlWrite: true }],
    ["application DDL access", { roleHasApplicationDdl: true }],
    ["application grant option", { roleHasApplicationGrantOptions: true }],
    [
      "parameter SET access",
      { parameterPrivileges: ["session_replication_role:SET"] },
    ],
  ] as const)("rejects Worker/Web %s privilege drift", (_label, override) => {
    expectContractError(
      () => attestEnvironment(scenario(override)),
      "ENV_ROLE_PRIVILEGE_DRIFT",
    );
  });

  it("rejects cross-database reachability and database grant options", () => {
    expectContractError(
      () =>
        attestEnvironment(
          scenario({ accessibleOtherDatabases: ["medota2_test:CONNECT"] }),
        ),
      "ENV_MARKER_INVALID",
    );
    expectContractError(
      () =>
        attestEnvironment(
          scenario({
            databaseAccessPrivileges: [
              "medota2_owner:CONNECT:true",
              "medota2_owner:CREATE:false",
              "medota2_owner:TEMPORARY:false",
              "medota2_web:CONNECT:false",
              "medota2_worker:CONNECT:false",
            ].sort(),
          }),
        ),
      "ENV_MARKER_INVALID",
    );
  });

  it("allows only the reviewed pgcrypto extension identity", () => {
    expect(() =>
      attestEnvironment(
        scenario({
          applicationExtensions: ["pgcrypto|1.4|public|medota2_owner"],
          applicationExtensionMembers: PGCRYPTO_EXTENSION_MEMBER_SIGNATURES,
        }),
      ),
    ).not.toThrow();
    expectContractError(
      () =>
        attestEnvironment(
          scenario({
            applicationExtensions: ["pgcrypto|1.5|public|medota2_owner"],
          }),
        ),
      "ENV_ROLE_PRIVILEGE_DRIFT",
    );
    expectContractError(
      () =>
        attestEnvironment(
          scenario({
            applicationExtensions: ["pgcrypto|1.4|public|medota2_owner"],
            applicationExtensionMembers: [
              ...PGCRYPTO_EXTENSION_MEMBER_SIGNATURES,
              "pg_class|table public.disguised_asset",
            ].sort(),
          }),
        ),
      "ENV_ROLE_PRIVILEGE_DRIFT",
    );
  });

  it("rejects default privileges that could grant future objects to a runtime role", () => {
    expectContractError(
      () =>
        attestEnvironment(
          scenario({
            applicationDefaultPrivileges: [
              "medota2_owner|<global>|T|medota2_owner:USAGE:false",
              "medota2_owner|<global>|f|medota2_owner:EXECUTE:false",
              "medota2_owner|public|r|medota2_web:UPDATE:false",
            ].sort(),
          }),
        ),
      "ENV_ROLE_PRIVILEGE_DRIFT",
    );
  });

  it("rejects external data links and prepared transactions", () => {
    expectContractError(
      () => attestEnvironment(scenario({ externalDataLinkCount: 1 })),
      "ENV_ROLE_PRIVILEGE_DRIFT",
    );
    expectContractError(
      () => attestEnvironment(scenario({ preparedTransactionCount: 1 })),
      "ENV_ROLE_PRIVILEGE_DRIFT",
    );
  });

  it("rejects Web business-data write access", () => {
    expectContractError(
      () =>
        attestEnvironment(
          scenario({
            applicationTableDmlPrivileges: ["public.import_runs:INSERT"],
          }),
        ),
      "ENV_ROLE_PRIVILEGE_DRIFT",
    );
    expect(() =>
      attestEnvironment(
        scenario({
          role: "worker",
          operation: "import",
          expectedRoleName: "medota2_worker",
          endpointUsername: "medota2_worker",
          currentUser: "medota2_worker",
          sessionUser: "medota2_worker",
          markerRoleName: "medota2_worker",
          applicationTableDmlPrivileges: ["public.import_runs:INSERT"],
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    [
      "direct head DML",
      { applicationTableDmlPrivileges: ["public.dataset_heads:UPDATE"] },
    ],
    [
      "column-only DML",
      { applicationColumnDmlPrivileges: ["public.import_runs.stage:UPDATE"] },
    ],
    [
      "rogue sequence",
      { applicationSequenceWritePrivileges: ["rogue.counter:USAGE"] },
    ],
    [
      "rogue security-definer routine",
      { applicationSecurityDefinerFunctions: ["rogue.mutate()"] },
    ],
  ] as const)("rejects Worker %s outside the allowlist", (_label, drift) => {
    expectContractError(
      () =>
        attestEnvironment(
          scenario({
            role: "worker",
            operation: "import",
            expectedRoleName: "medota2_worker",
            endpointUsername: "medota2_worker",
            currentUser: "medota2_worker",
            sessionUser: "medota2_worker",
            markerRoleName: "medota2_worker",
            ...drift,
          }),
        ),
      "ENV_ROLE_PRIVILEGE_DRIFT",
    );
  });

  it.each([
    [
      "a changed security-definer body",
      {
        applicationSecurityDefinerInventory: [
          'public.promote_asset_dataset_version(uuid)|medota2_owner|f|{"search_path=pg_catalog, public"}|' +
            "0".repeat(64),
        ],
      },
    ],
    [
      "an application trigger",
      { applicationAutomationObjects: ["trigger:public.import_runs:rogue"] },
    ],
    [
      "an unreviewed invoker routine",
      { applicationInvokerRoutines: ["public.rogue()|c|f"] },
    ],
    [
      "an FK cascade write path",
      {
        applicationReferentialWritePaths: [
          "delete-cascade:hero_import_staging->dataset_heads:rogue_fk",
        ],
      },
    ],
  ] as const)(
    "rejects %s outside reviewed schema semantics",
    (_label, drift) => {
      expectContractError(
        () => attestEnvironment(scenario(drift)),
        "ENV_ROLE_PRIVILEGE_DRIFT",
      );
    },
  );

  it("requires reset policy convergence across all three roles", () => {
    const base = attestEnvironment(scenario());
    const identities: DatabaseIdentity[] = [
      { ...base, databaseRole: "web" },
      { ...base, databaseRole: "worker" },
      { ...base, databaseRole: "migration", resetPolicy: "run-scoped" },
    ];
    expectContractError(
      () => assertDatabaseIdentitiesConverge(identities),
      "ENV_TARGET_MISMATCH",
    );
  });

  it.each([
    ["search_path", { searchPath: "pg_temp, public" }],
    ["row security", { rowSecurity: "off" }],
    ["replication role", { sessionReplicationRole: "replica" }],
  ] as const)("rejects a poisoned %s baseline", (_label, override) => {
    expectContractError(
      () => attestEnvironment(scenario(override)),
      "ENV_MARKER_INVALID",
    );
  });

  it("rejects a poisoned Web default read-only policy", () => {
    expectContractError(
      () => attestEnvironment(scenario({ defaultTransactionReadOnly: "off" })),
      "ENV_ROLE_PRIVILEGE_DRIFT",
    );
  });

  it("rejects writes on a recovery target", () => {
    expectContractError(
      () =>
        attestEnvironment(
          scenario({
            role: "worker",
            operation: "import",
            expectedRoleName: "medota2_worker",
            endpointUsername: "medota2_worker",
            currentUser: "medota2_worker",
            sessionUser: "medota2_worker",
            markerRoleName: "medota2_worker",
            inRecovery: true,
          }),
        ),
      "ENV_OPERATION_NOT_ALLOWED",
    );
  });
});

describe("Environment Contract destructive-operation policy", () => {
  it("reserves Test Worker access for the fixture adapter", () => {
    const testWorker = {
      declaration: declaration("test", "run-42"),
      role: "worker" as const,
      resetPolicy: "run-scoped" as const,
      endpointDatabaseName: "medota2_test",
      markerDatabaseName: "medota2_test",
      markerEnvironment: "test" as const,
      markerDataClass: "synthetic-fixture" as const,
      expectedRoleName: "medota2_worker",
      endpointUsername: "medota2_worker",
      currentUser: "medota2_worker",
      sessionUser: "medota2_worker",
      markerRoleName: "medota2_worker",
      applicationTableDmlPrivileges: ["public.import_runs:INSERT"],
    };
    expectContractError(
      () => attestEnvironment(scenario({ ...testWorker, operation: "import" })),
      "ENV_OPERATION_NOT_ALLOWED",
    );
    expect(() =>
      attestEnvironment(scenario({ ...testWorker, operation: "fixture" })),
    ).not.toThrow();
  });

  it("allows seed only for a run-scoped synthetic test", () => {
    expect(() =>
      attestEnvironment(
        scenario({
          declaration: declaration("test", "run-42"),
          role: "migration",
          operation: "seed",
          resetPolicy: "run-scoped",
          endpointDatabaseName: "medota2_test",
          markerDatabaseName: "medota2_test",
          markerEnvironment: "test",
          markerDataClass: "synthetic-fixture",
          expectedRoleName: "medota2_owner",
          endpointUsername: "medota2_owner",
          currentUser: "medota2_owner",
          sessionUser: "medota2_owner",
          markerRoleName: "medota2_owner",
        }),
      ),
    ).not.toThrow();
    expectContractError(
      () =>
        attestEnvironment(
          scenario({
            declaration: declaration("test", null),
            role: "migration",
            operation: "seed",
            resetPolicy: "run-scoped",
            endpointDatabaseName: "medota2_test",
            markerDatabaseName: "medota2_test",
            markerEnvironment: "test",
            markerDataClass: "synthetic-fixture",
            expectedRoleName: "medota2_owner",
            endpointUsername: "medota2_owner",
            currentUser: "medota2_owner",
            sessionUser: "medota2_owner",
            markerRoleName: "medota2_owner",
          }),
        ),
      "ENV_DESTRUCTIVE_CONFIRMATION_REQUIRED",
    );
  });

  it("requires the exact local-review database name for reset", () => {
    const localReset = scenario({
      declaration: declaration("local-review"),
      role: "migration",
      operation: "reset",
      resetPolicy: "explicit-rebuild",
      endpointDatabaseName: "medota2_local",
      markerDatabaseName: "medota2_local",
      markerEnvironment: "local-review",
      markerDataClass: "production-snapshot",
      expectedRoleName: "medota2_owner",
      endpointUsername: "medota2_owner",
      currentUser: "medota2_owner",
      sessionUser: "medota2_owner",
      markerRoleName: "medota2_owner",
    });
    expectContractError(
      () => attestEnvironment(localReset),
      "ENV_DESTRUCTIVE_CONFIRMATION_REQUIRED",
    );
    expect(() =>
      attestEnvironment({ ...localReset, confirmation: "medota2_local" }),
    ).not.toThrow();
    expectContractError(
      () =>
        attestEnvironment({
          ...localReset,
          confirmation: "medota2_local",
          probe: {
            ...localReset.probe,
            marker: { ...localReset.probe.marker, resetPolicy: "manual" },
          },
        }),
      "ENV_DESTRUCTIVE_CONFIRMATION_REQUIRED",
    );
  });

  it("denies every production capability except Web read", () => {
    const productionWrite = scenario({
      declaration: declaration("production", null, {
        expectedInstanceId: INSTANCE_ID,
        expectedDatabaseId: DATABASE_ID,
        expectedPostgresSystemIdentifier: POSTGRES_SYSTEM_IDENTIFIER,
      }),
      role: "worker",
      operation: "promote",
      resetPolicy: "never",
      markerEnvironment: "production",
      markerDataClass: "live-production",
      expectedRoleName: "medota2_worker",
      endpointUsername: "medota2_worker",
      currentUser: "medota2_worker",
      sessionUser: "medota2_worker",
      markerRoleName: "medota2_worker",
    });
    expectContractError(
      () => attestEnvironment(productionWrite),
      "ENV_OPERATION_NOT_ALLOWED",
    );
    expectContractError(
      () =>
        attestEnvironment({
          ...productionWrite,
          confirmation: DATABASE_ID,
        }),
      "ENV_OPERATION_NOT_ALLOWED",
    );
    expect(() =>
      attestEnvironment(
        scenario({
          declaration: declaration("production", null, {
            expectedInstanceId: INSTANCE_ID,
            expectedDatabaseId: DATABASE_ID,
            expectedPostgresSystemIdentifier: POSTGRES_SYSTEM_IDENTIFIER,
          }),
          resetPolicy: "never",
          markerEnvironment: "production",
          markerDataClass: "live-production",
        }),
      ),
    ).not.toThrow();
  });

  it.each([
    ["web", "import"],
    ["worker", "reset"],
    ["migration", "promote"],
  ] as const)("rejects %s role attempting %s", (role, operation) => {
    expectContractError(
      () => attestEnvironment(scenario({ role, operation })),
      "ENV_OPERATION_NOT_ALLOWED",
    );
  });
});

const INSTANCE_ID = "11111111-1111-4111-8111-111111111111";
const DATABASE_ID = "22222222-2222-4222-8222-222222222222";
const POSTGRES_SYSTEM_IDENTIFIER = "7679822317268934693";

function declaration(
  environment: RuntimeEnvironment,
  runId: string | null = null,
  expected: {
    expectedInstanceId?: string;
    expectedDatabaseId?: string;
    expectedPostgresSystemIdentifier?: string;
  } = {},
): EnvironmentDeclaration {
  const dataClasses: Record<RuntimeEnvironment, DataClass> = {
    development: "sandbox",
    test: "synthetic-fixture",
    "local-review": "production-snapshot",
    production: "live-production",
  };
  return {
    contractVersion: 1,
    environment,
    dataClass: dataClasses[environment],
    runId,
    expectedInstanceId: expected.expectedInstanceId ?? null,
    expectedDatabaseId: expected.expectedDatabaseId ?? null,
    expectedPostgresSystemIdentifier:
      expected.expectedPostgresSystemIdentifier ?? null,
  };
}

function scenario(
  override: {
    declaration?: EnvironmentDeclaration;
    role?: DatabaseRole;
    operation?: DatabaseOperation;
    resetPolicy?: ResetPolicy;
    expectedRoleName?: string;
    endpointUsername?: string;
    endpointDatabaseName?: string;
    currentUser?: string;
    sessionUser?: string;
    markerRoleName?: string;
    markerEnvironment?: RuntimeEnvironment;
    markerDataClass?: DataClass;
    markerDatabaseName?: string;
    transactionReadOnly?: boolean;
    roleSuperuser?: boolean;
    roleCreateDatabase?: boolean;
    roleCreateRole?: boolean;
    roleInherit?: boolean;
    roleLogin?: boolean;
    roleReplication?: boolean;
    roleBypassRls?: boolean;
    roleMembershipCount?: number;
    expectedRoleMatrix?: readonly string[];
    roleHasControlWrite?: boolean;
    databaseOwner?: string;
    databaseAccessPrivileges?: readonly string[];
    accessibleOtherDatabases?: readonly string[];
    controlSchemaOwner?: string | null;
    controlRelationOwner?: string | null;
    controlRelationKind?: string | null;
    controlTableShape?: readonly string[];
    controlConstraintShape?: readonly string[];
    controlOwnerIsIsolated?: boolean;
    roleHasApplicationDdl?: boolean;
    roleHasApplicationGrantOptions?: boolean;
    applicationDefaultPrivileges?: readonly string[];
    applicationExtensions?: readonly string[];
    applicationExtensionMembers?: readonly string[];
    externalDataLinkCount?: number;
    preparedTransactionCount?: number;
    unexpectedApplicationObjectOwners?: readonly string[];
    applicationTableDmlPrivileges?: readonly string[];
    applicationColumnDmlPrivileges?: readonly string[];
    applicationSequenceWritePrivileges?: readonly string[];
    applicationSecurityDefinerFunctions?: readonly string[];
    applicationSecurityDefinerInventory?: readonly string[];
    applicationInvokerRoutines?: readonly string[];
    applicationAutomationObjects?: readonly string[];
    applicationReferentialWritePaths?: readonly string[];
    parameterPrivileges?: readonly string[];
    dangerousBuiltinFunctions?: readonly string[];
    largeObjectPrivileges?: readonly string[];
    roleOwnsLargeObjects?: boolean;
    inRecovery?: boolean;
    expectedInstanceId?: string;
    expectedDatabaseId?: string;
    expectedPostgresSystemIdentifier?: string;
    postgresSystemIdentifier?: string;
    searchPath?: string;
    rowSecurity?: string;
    sessionReplicationRole?: string;
    defaultTransactionReadOnly?: string;
    serverAddress?: string | null;
    serverPort?: number | null;
  } = {},
): Parameters<typeof attestEnvironment>[0] {
  const role = override.role ?? "web";
  const expectedRoleName = override.expectedRoleName ?? "medota2_web";
  const baseDeclaration = override.declaration ?? declaration("development");
  const selectedDeclaration: EnvironmentDeclaration = {
    ...baseDeclaration,
    expectedInstanceId:
      override.expectedInstanceId ?? baseDeclaration.expectedInstanceId,
    expectedDatabaseId:
      override.expectedDatabaseId ?? baseDeclaration.expectedDatabaseId,
    expectedPostgresSystemIdentifier:
      override.expectedPostgresSystemIdentifier ??
      baseDeclaration.expectedPostgresSystemIdentifier,
  };
  const markerRoleName = override.markerRoleName ?? expectedRoleName;
  const actualDatabaseName = override.markerDatabaseName ?? "medota2";
  const expectedRoleNames = {
    migration: "medota2_owner",
    worker: "medota2_worker",
    web: "medota2_web",
    [role]: expectedRoleName,
  };
  return {
    declaration: selectedDeclaration,
    role,
    operation: override.operation ?? "read",
    expectedRoleNames,
    expectedControlOwnerName: "medota2_control_owner",
    confirmation: null,
    endpoint: {
      hostname: "127.0.0.1",
      port: 54321,
      databaseName: override.endpointDatabaseName ?? "medota2",
      username: override.endpointUsername ?? expectedRoleName,
    },
    probe: {
      databaseName: actualDatabaseName,
      currentUser: override.currentUser ?? expectedRoleName,
      sessionUser: override.sessionUser ?? expectedRoleName,
      serverAddress:
        override.serverAddress === undefined
          ? "172.18.0.2"
          : override.serverAddress,
      serverPort:
        override.serverPort === undefined ? 5432 : override.serverPort,
      inRecovery: override.inRecovery ?? false,
      transactionReadOnly: override.transactionReadOnly ?? true,
      roleSuperuser: override.roleSuperuser ?? false,
      roleCreateDatabase: override.roleCreateDatabase ?? false,
      roleCreateRole: override.roleCreateRole ?? false,
      roleInherit: override.roleInherit ?? false,
      roleLogin: override.roleLogin ?? true,
      roleReplication: override.roleReplication ?? false,
      roleBypassRls: override.roleBypassRls ?? false,
      roleMembershipCount: override.roleMembershipCount ?? 0,
      expectedRoleMatrix:
        override.expectedRoleMatrix ??
        Object.values(expectedRoleNames)
          .map(
            (roleName) =>
              roleName + ":false:false:false:false:true:false:false:0",
          )
          .sort(),
      roleHasControlWrite: override.roleHasControlWrite ?? false,
      databaseOwner: override.databaseOwner ?? expectedRoleNames.migration,
      databaseAccessPrivileges:
        override.databaseAccessPrivileges ??
        [
          expectedRoleNames.migration + ":CONNECT:false",
          expectedRoleNames.migration + ":CREATE:false",
          expectedRoleNames.migration + ":TEMPORARY:false",
          expectedRoleNames.web + ":CONNECT:false",
          expectedRoleNames.worker + ":CONNECT:false",
        ].sort(),
      accessibleOtherDatabases: override.accessibleOtherDatabases ?? [],
      controlSchemaOwner:
        override.controlSchemaOwner === undefined
          ? "medota2_control_owner"
          : override.controlSchemaOwner,
      controlRelationOwner:
        override.controlRelationOwner === undefined
          ? "medota2_control_owner"
          : override.controlRelationOwner,
      controlRelationKind: override.controlRelationKind ?? "r",
      controlTableShape: override.controlTableShape ?? CONTROL_TABLE_SHAPE,
      controlConstraintShape:
        override.controlConstraintShape ?? CONTROL_CONSTRAINT_SHAPE,
      controlOwnerIsIsolated: override.controlOwnerIsIsolated ?? true,
      roleHasApplicationDdl: override.roleHasApplicationDdl ?? false,
      roleHasApplicationGrantOptions:
        override.roleHasApplicationGrantOptions ?? false,
      applicationDefaultPrivileges:
        override.applicationDefaultPrivileges ??
        [
          expectedRoleNames.migration +
            "|<global>|T|" +
            expectedRoleNames.migration +
            ":USAGE:false",
          expectedRoleNames.migration +
            "|<global>|f|" +
            expectedRoleNames.migration +
            ":EXECUTE:false",
        ].sort(),
      applicationExtensions: override.applicationExtensions ?? [],
      applicationExtensionMembers: override.applicationExtensionMembers ?? [],
      externalDataLinkCount: override.externalDataLinkCount ?? 0,
      preparedTransactionCount: override.preparedTransactionCount ?? 0,
      unexpectedApplicationObjectOwners:
        override.unexpectedApplicationObjectOwners ?? [],
      applicationTableDmlPrivileges:
        override.applicationTableDmlPrivileges ?? [],
      applicationColumnDmlPrivileges:
        override.applicationColumnDmlPrivileges ?? [],
      applicationSequenceWritePrivileges:
        override.applicationSequenceWritePrivileges ?? [],
      applicationSecurityDefinerFunctions:
        override.applicationSecurityDefinerFunctions ?? [],
      applicationSecurityDefinerInventory:
        override.applicationSecurityDefinerInventory ?? [],
      applicationInvokerRoutines: override.applicationInvokerRoutines ?? [],
      applicationAutomationObjects: override.applicationAutomationObjects ?? [],
      applicationReferentialWritePaths:
        override.applicationReferentialWritePaths ?? [],
      parameterPrivileges: override.parameterPrivileges ?? [],
      dangerousBuiltinFunctions: override.dangerousBuiltinFunctions ?? [],
      largeObjectPrivileges: override.largeObjectPrivileges ?? [],
      roleOwnsLargeObjects: override.roleOwnsLargeObjects ?? false,
      postgresSystemIdentifier:
        override.postgresSystemIdentifier ?? POSTGRES_SYSTEM_IDENTIFIER,
      searchPath: override.searchPath ?? "pg_catalog, public, pg_temp",
      rowSecurity: override.rowSecurity ?? "on",
      sessionReplicationRole: override.sessionReplicationRole ?? "origin",
      defaultTransactionReadOnly:
        override.defaultTransactionReadOnly ?? (role === "web" ? "on" : "off"),
      marker: {
        contractVersion: 1,
        instanceId: INSTANCE_ID,
        databaseId: DATABASE_ID,
        environment:
          override.markerEnvironment ?? selectedDeclaration.environment,
        dataClass: override.markerDataClass ?? selectedDeclaration.dataClass,
        databaseName: actualDatabaseName,
        state: "active",
        resetPolicy: override.resetPolicy ?? "manual",
        migrationRole: role === "migration" ? markerRoleName : "medota2_owner",
        workerRole: role === "worker" ? markerRoleName : "medota2_worker",
        webRole: role === "web" ? markerRoleName : "medota2_web",
      },
    } satisfies DatabaseProbeSnapshot,
  };
}

function expectContractError(
  action: () => unknown,
  code: EnvironmentContractError["code"],
): void {
  try {
    action();
    throw new Error("Expected EnvironmentContractError");
  } catch (error) {
    expect(error).toBeInstanceOf(EnvironmentContractError);
    expect((error as EnvironmentContractError).code).toBe(code);
    expect((error as Error).message).not.toContain("postgresql://");
    expect((error as Error).message).not.toContain("secret");
    expect((error as Error).cause).toBeUndefined();
  }
}
