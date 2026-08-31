import {
  type DatabaseIdentity,
  type DatabaseOperation,
  type DatabaseRole,
  type EnvironmentDeclaration,
  type ResetPolicy,
  type RuntimeEnvironment,
} from "@/domain/environment";

export type EnvironmentContractErrorCode =
  | "ENV_CONFIGURATION_INVALID"
  | "ENV_URL_POLICY_VIOLATION"
  | "ENV_CONNECT_FAILED"
  | "ENV_MARKER_MISSING"
  | "ENV_MARKER_INVALID"
  | "ENV_TARGET_MISMATCH"
  | "ENV_ROLE_MISMATCH"
  | "ENV_ROLE_PRIVILEGE_DRIFT"
  | "ENV_OPERATION_NOT_ALLOWED"
  | "ENV_DESTRUCTIVE_CONFIRMATION_REQUIRED";

const ERROR_REMEDIATION: Readonly<
  Record<EnvironmentContractErrorCode, string>
> = {
  ENV_CONFIGURATION_INVALID:
    "Declare one supported Medota2 environment and data class before starting the process.",
  ENV_URL_POLICY_VIOLATION:
    "Use the environment-specific PostgreSQL URL without unsafe query options or a remote non-production endpoint.",
  ENV_CONNECT_FAILED:
    "Confirm that the selected PostgreSQL environment is running and reachable.",
  ENV_MARKER_MISSING:
    "Provision or explicitly adopt the database environment marker before running Medota2.",
  ENV_MARKER_INVALID:
    "Repair the database-owned environment marker through the provisioning workflow.",
  ENV_TARGET_MISMATCH:
    "Select the environment whose database identity matches the configured target.",
  ENV_ROLE_MISMATCH:
    "Use the credential assigned to this Medota2 database role.",
  ENV_ROLE_PRIVILEGE_DRIFT:
    "Restore the least-privilege grants for the selected database role.",
  ENV_OPERATION_NOT_ALLOWED:
    "Run an operation allowed by the verified environment and database role.",
  ENV_DESTRUCTIVE_CONFIRMATION_REQUIRED:
    "Provide the run identity or exact database confirmation required for this destructive operation.",
};

export class EnvironmentContractError extends Error {
  readonly code: EnvironmentContractErrorCode;
  readonly remediation: string;

  constructor(code: EnvironmentContractErrorCode, cause?: unknown) {
    super(code + ": " + ERROR_REMEDIATION[code]);
    void cause;
    this.name = "EnvironmentContractError";
    this.code = code;
    this.remediation = ERROR_REMEDIATION[code];
  }
}

export interface ParsedDatabaseEndpoint {
  hostname: string;
  port: number;
  databaseName: string;
  username: string;
}

export interface EnvironmentMarkerSnapshot {
  contractVersion: number;
  instanceId: string;
  databaseId: string;
  environment: string;
  dataClass: string;
  databaseName: string;
  state: string;
  resetPolicy: string;
  migrationRole: string;
  workerRole: string;
  webRole: string;
}

export interface DatabaseProbeSnapshot {
  databaseName: string;
  currentUser: string;
  sessionUser: string;
  serverAddress: string | null;
  serverPort: number | null;
  inRecovery: boolean;
  transactionReadOnly: boolean;
  roleSuperuser: boolean;
  roleCreateDatabase: boolean;
  roleCreateRole: boolean;
  roleInherit: boolean;
  roleLogin: boolean;
  roleReplication: boolean;
  roleBypassRls: boolean;
  roleMembershipCount: number;
  expectedRoleMatrix: readonly string[];
  roleHasControlWrite: boolean;
  databaseOwner: string;
  databaseAccessPrivileges: readonly string[];
  accessibleOtherDatabases: readonly string[];
  controlSchemaOwner: string | null;
  controlRelationOwner: string | null;
  controlRelationKind: string | null;
  controlTableShape: readonly string[];
  controlConstraintShape: readonly string[];
  controlOwnerIsIsolated: boolean;
  roleHasApplicationDdl: boolean;
  roleHasApplicationGrantOptions: boolean;
  applicationDefaultPrivileges: readonly string[];
  applicationExtensions: readonly string[];
  applicationExtensionMembers: readonly string[];
  externalDataLinkCount: number;
  preparedTransactionCount: number;
  unexpectedApplicationObjectOwners: readonly string[];
  applicationTableDmlPrivileges: readonly string[];
  applicationColumnDmlPrivileges: readonly string[];
  applicationSequenceWritePrivileges: readonly string[];
  applicationSecurityDefinerFunctions: readonly string[];
  applicationSecurityDefinerInventory: readonly string[];
  applicationInvokerRoutines: readonly string[];
  applicationAutomationObjects: readonly string[];
  applicationReferentialWritePaths: readonly string[];
  parameterPrivileges: readonly string[];
  dangerousBuiltinFunctions: readonly string[];
  largeObjectPrivileges: readonly string[];
  roleOwnsLargeObjects: boolean;
  postgresSystemIdentifier: string;
  searchPath: string;
  rowSecurity: string;
  sessionReplicationRole: string;
  defaultTransactionReadOnly: string;
  marker: EnvironmentMarkerSnapshot;
}

// PostgreSQL 18 / pgcrypto 1.4. Adoption may only replace an extension whose
// member set is exactly this reviewed inventory. This prevents an attacker from
// attaching an application object to pgcrypto and having DROP EXTENSION remove
// it as an apparently trusted member.
export const PGCRYPTO_EXTENSION_MEMBER_SIGNATURES = [
  "pg_proc|public.armor(bytea)",
  "pg_proc|public.armor(bytea, text[], text[])",
  "pg_proc|public.crypt(text, text)",
  "pg_proc|public.dearmor(text)",
  "pg_proc|public.decrypt(bytea, bytea, text)",
  "pg_proc|public.decrypt_iv(bytea, bytea, bytea, text)",
  "pg_proc|public.digest(bytea, text)",
  "pg_proc|public.digest(text, text)",
  "pg_proc|public.encrypt(bytea, bytea, text)",
  "pg_proc|public.encrypt_iv(bytea, bytea, bytea, text)",
  "pg_proc|public.fips_mode()",
  "pg_proc|public.gen_random_bytes(integer)",
  "pg_proc|public.gen_random_uuid()",
  "pg_proc|public.gen_salt(text)",
  "pg_proc|public.gen_salt(text, integer)",
  "pg_proc|public.hmac(bytea, bytea, text)",
  "pg_proc|public.hmac(text, text, text)",
  "pg_proc|public.pgp_armor_headers(text, OUT key text, OUT value text)",
  "pg_proc|public.pgp_key_id(bytea)",
  "pg_proc|public.pgp_pub_decrypt(bytea, bytea)",
  "pg_proc|public.pgp_pub_decrypt(bytea, bytea, text)",
  "pg_proc|public.pgp_pub_decrypt(bytea, bytea, text, text)",
  "pg_proc|public.pgp_pub_decrypt_bytea(bytea, bytea)",
  "pg_proc|public.pgp_pub_decrypt_bytea(bytea, bytea, text)",
  "pg_proc|public.pgp_pub_decrypt_bytea(bytea, bytea, text, text)",
  "pg_proc|public.pgp_pub_encrypt(text, bytea)",
  "pg_proc|public.pgp_pub_encrypt(text, bytea, text)",
  "pg_proc|public.pgp_pub_encrypt_bytea(bytea, bytea)",
  "pg_proc|public.pgp_pub_encrypt_bytea(bytea, bytea, text)",
  "pg_proc|public.pgp_sym_decrypt(bytea, text)",
  "pg_proc|public.pgp_sym_decrypt(bytea, text, text)",
  "pg_proc|public.pgp_sym_decrypt_bytea(bytea, text)",
  "pg_proc|public.pgp_sym_decrypt_bytea(bytea, text, text)",
  "pg_proc|public.pgp_sym_encrypt(text, text)",
  "pg_proc|public.pgp_sym_encrypt(text, text, text)",
  "pg_proc|public.pgp_sym_encrypt_bytea(bytea, text)",
  "pg_proc|public.pgp_sym_encrypt_bytea(bytea, text, text)",
] as const;

export function parseDatabaseEndpoint(
  rawUrl: string,
  environment: RuntimeEnvironment,
): ParsedDatabaseEndpoint {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new EnvironmentContractError("ENV_URL_POLICY_VIOLATION", error);
  }
  if (parsed.protocol !== "postgresql:") {
    throw new EnvironmentContractError("ENV_URL_POLICY_VIOLATION");
  }
  let username: string;
  let databaseName: string;
  try {
    username = decodeURIComponent(parsed.username);
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/u, ""));
  } catch (error) {
    throw new EnvironmentContractError("ENV_URL_POLICY_VIOLATION", error);
  }
  if (
    !username ||
    !databaseName ||
    databaseName.includes("/") ||
    !parsed.hostname ||
    parsed.hash ||
    !/^[a-z_][a-z0-9_-]{0,62}$/u.test(username) ||
    !/^[a-z_][a-z0-9_-]{0,62}$/u.test(databaseName)
  ) {
    throw new EnvironmentContractError("ENV_URL_POLICY_VIOLATION");
  }
  const allowedSearchParameters = new Set([
    "sslmode",
    "sslrootcert",
    "sslcert",
    "sslkey",
    "channel_binding",
  ]);
  const seenSearchParameters = new Set<string>();
  for (const key of parsed.searchParams.keys()) {
    if (!allowedSearchParameters.has(key) || seenSearchParameters.has(key)) {
      throw new EnvironmentContractError("ENV_URL_POLICY_VIOLATION");
    }
    seenSearchParameters.add(key);
  }
  if (environment === "production") {
    if (parsed.searchParams.get("sslmode") !== "verify-full") {
      throw new EnvironmentContractError("ENV_URL_POLICY_VIOLATION");
    }
  } else if (!isLoopbackHost(parsed.hostname)) {
    throw new EnvironmentContractError("ENV_URL_POLICY_VIOLATION");
  }
  const port = parsed.port ? Number(parsed.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EnvironmentContractError("ENV_URL_POLICY_VIOLATION");
  }
  return {
    hostname: parsed.hostname,
    port,
    databaseName,
    username,
  };
}

export function attestEnvironment(input: {
  declaration: EnvironmentDeclaration;
  role: DatabaseRole;
  operation: DatabaseOperation;
  expectedRoleNames: Readonly<Record<DatabaseRole, string>>;
  expectedControlOwnerName: string;
  endpoint: ParsedDatabaseEndpoint;
  probe: DatabaseProbeSnapshot;
  confirmation: string | null;
  authorizeOperation?: boolean;
  expectedMarkerState?: "active" | "quarantined";
}): DatabaseIdentity {
  const {
    declaration,
    role,
    operation,
    expectedRoleNames,
    expectedControlOwnerName,
    endpoint,
    probe,
    confirmation,
    authorizeOperation = true,
    expectedMarkerState = "active",
  } = input;
  const marker = probe.marker;
  const expectedRoleName = expectedRoleNames[role];
  if (
    marker.contractVersion !== declaration.contractVersion ||
    marker.state !== expectedMarkerState ||
    !isRuntimeEnvironment(marker.environment) ||
    !isResetPolicy(marker.resetPolicy)
  ) {
    throw new EnvironmentContractError("ENV_MARKER_INVALID");
  }
  if (
    marker.environment !== declaration.environment ||
    marker.dataClass !== declaration.dataClass ||
    marker.databaseName !== probe.databaseName ||
    endpoint.databaseName !== probe.databaseName ||
    !probe.serverAddress ||
    probe.serverPort === null
  ) {
    throw new EnvironmentContractError("ENV_TARGET_MISMATCH");
  }
  if (
    declaration.expectedInstanceId &&
    declaration.expectedInstanceId !== marker.instanceId
  ) {
    throw new EnvironmentContractError("ENV_TARGET_MISMATCH");
  }
  if (
    declaration.expectedDatabaseId &&
    declaration.expectedDatabaseId !== marker.databaseId
  ) {
    throw new EnvironmentContractError("ENV_TARGET_MISMATCH");
  }
  if (
    declaration.expectedPostgresSystemIdentifier &&
    declaration.expectedPostgresSystemIdentifier !==
      probe.postgresSystemIdentifier
  ) {
    throw new EnvironmentContractError("ENV_TARGET_MISMATCH");
  }
  const markerRole = roleNameFromMarker(marker, role);
  if (
    marker.migrationRole !== expectedRoleNames.migration ||
    marker.workerRole !== expectedRoleNames.worker ||
    marker.webRole !== expectedRoleNames.web ||
    endpoint.username !== expectedRoleName ||
    markerRole !== expectedRoleName ||
    probe.currentUser !== expectedRoleName ||
    probe.sessionUser !== expectedRoleName
  ) {
    throw new EnvironmentContractError("ENV_ROLE_MISMATCH");
  }
  if (
    probe.databaseOwner !== expectedRoleNames.migration ||
    !sameStringArray(
      probe.databaseAccessPrivileges,
      expectedDatabaseAccessPrivileges(expectedRoleNames),
    ) ||
    probe.accessibleOtherDatabases.length > 0 ||
    probe.controlSchemaOwner !== expectedControlOwnerName ||
    probe.controlRelationOwner !== expectedControlOwnerName ||
    probe.controlRelationKind !== "r" ||
    !sameStringArray(probe.controlTableShape, CONTROL_TABLE_SHAPE) ||
    !sameStringArray(probe.controlConstraintShape, CONTROL_CONSTRAINT_SHAPE) ||
    !probe.controlOwnerIsIsolated
  ) {
    throw new EnvironmentContractError("ENV_MARKER_INVALID");
  }
  if (
    !sameStringArray(
      probe.applicationDefaultPrivileges,
      expectedApplicationDefaultPrivileges(expectedRoleNames.migration),
    ) ||
    !applicationExtensionsAreAllowlisted(
      probe.applicationExtensions,
      expectedRoleNames.migration,
    ) ||
    !applicationExtensionMembersAreAllowlisted(
      probe.applicationExtensions,
      probe.applicationExtensionMembers,
    ) ||
    probe.externalDataLinkCount !== 0 ||
    probe.preparedTransactionCount !== 0 ||
    probe.unexpectedApplicationObjectOwners.length > 0 ||
    probe.applicationInvokerRoutines.length > 0 ||
    probe.applicationAutomationObjects.length > 0 ||
    probe.applicationReferentialWritePaths.length > 0 ||
    !isSubset(
      probe.applicationSecurityDefinerInventory,
      reviewedSecurityDefinerDefinitions(expectedRoleNames.migration),
    )
  ) {
    throw new EnvironmentContractError("ENV_ROLE_PRIVILEGE_DRIFT");
  }
  if (
    !probe.transactionReadOnly ||
    probe.searchPath !== "pg_catalog, public, pg_temp" ||
    probe.rowSecurity !== "on" ||
    probe.sessionReplicationRole !== "origin"
  ) {
    throw new EnvironmentContractError("ENV_MARKER_INVALID");
  }
  if (
    probe.roleSuperuser ||
    probe.roleCreateDatabase ||
    probe.roleCreateRole ||
    probe.roleInherit ||
    !probe.roleLogin ||
    probe.roleReplication ||
    probe.roleBypassRls ||
    probe.roleMembershipCount !== 0 ||
    !sameStringArray(
      probe.expectedRoleMatrix,
      expectedRuntimeRoleMatrix(expectedRoleNames),
    ) ||
    probe.roleHasControlWrite ||
    probe.parameterPrivileges.length > 0 ||
    probe.roleOwnsLargeObjects ||
    probe.dangerousBuiltinFunctions.length > 0 ||
    probe.largeObjectPrivileges.length > 0
  ) {
    throw new EnvironmentContractError("ENV_ROLE_PRIVILEGE_DRIFT");
  }
  if (role !== "migration" && probe.roleHasApplicationDdl) {
    throw new EnvironmentContractError("ENV_ROLE_PRIVILEGE_DRIFT");
  }
  if (role !== "migration" && probe.roleHasApplicationGrantOptions) {
    throw new EnvironmentContractError("ENV_ROLE_PRIVILEGE_DRIFT");
  }
  if (role === "web" && hasAnyApplicationWritePrivilege(probe)) {
    throw new EnvironmentContractError("ENV_ROLE_PRIVILEGE_DRIFT");
  }
  if (role === "worker") assertWorkerPrivilegesAreAllowlisted(probe);
  if (
    (role === "web" && probe.defaultTransactionReadOnly !== "on") ||
    (role !== "web" && probe.defaultTransactionReadOnly !== "off")
  ) {
    throw new EnvironmentContractError("ENV_ROLE_PRIVILEGE_DRIFT");
  }
  if (authorizeOperation && operation !== "read" && probe.inRecovery) {
    throw new EnvironmentContractError("ENV_OPERATION_NOT_ALLOWED");
  }
  if (authorizeOperation) {
    assertRoleAllowsOperation(role, operation);
    assertEnvironmentAllowsOperation(
      declaration,
      role,
      operation,
      marker.resetPolicy,
      marker.databaseName,
      confirmation,
    );
  }
  return {
    contractVersion: marker.contractVersion,
    environment: declaration.environment,
    dataClass: declaration.dataClass,
    instanceId: marker.instanceId,
    databaseId: marker.databaseId,
    databaseName: marker.databaseName,
    databaseRole: role,
    sessionUser: probe.sessionUser,
    endpointHost: endpoint.hostname,
    endpointPort: endpoint.port,
    serverAddress: probe.serverAddress,
    serverPort: probe.serverPort,
    postgresSystemIdentifier: probe.postgresSystemIdentifier,
    resetPolicy: marker.resetPolicy,
    runId: declaration.runId,
    safeFingerprint:
      marker.instanceId.slice(0, 8) + "-" + marker.databaseId.slice(0, 8),
  };
}

const WORKER_TABLE_DML_ALLOWLIST = new Set([
  "public.abilities:INSERT",
  "public.ability_id_mappings:INSERT",
  "public.ability_localizations:INSERT",
  "public.ability_values:INSERT",
  "public.asset_blobs:INSERT",
  "public.asset_dataset_versions:INSERT",
  "public.asset_objects:INSERT",
  "public.asset_variants:INSERT",
  "public.catalog_import_staging:DELETE",
  "public.catalog_import_staging:INSERT",
  "public.catalog_semantic_diffs:INSERT",
  "public.entity_asset_bindings:INSERT",
  "public.entity_source_records:INSERT",
  "public.facet_ability_bindings:INSERT",
  "public.facets:INSERT",
  "public.hero_ability_bindings:INSERT",
  "public.hero_catalog_dataset_versions:INSERT",
  "public.hero_import_staging:DELETE",
  "public.hero_import_staging:INSERT",
  "public.hero_localizations:INSERT",
  "public.hero_reference_comparisons:INSERT",
  "public.hero_reference_diffs:INSERT",
  "public.hero_roles:INSERT",
  "public.hero_source_records:INSERT",
  "public.heroes:INSERT",
  "public.import_runs:INSERT",
  "public.import_runs:UPDATE",
  "public.reference_hero_records:INSERT",
  "public.reference_snapshots:INSERT",
  "public.source_snapshot_files:INSERT",
  "public.source_snapshots:INSERT",
]);

const WORKER_SEQUENCE_WRITE_ALLOWLIST = new Set([
  "public.hero_reference_diffs_id_seq:USAGE",
]);

export const WORKER_SECURITY_DEFINER_DEFINITION_MANIFEST = [
  [
    "public.promote_asset_dataset_version(uuid)",
    "75b7a50248c9ca8982ff7ee20bd59d0d6938d9c6a1a97d571f75d5b6a828b8cc",
  ],
  [
    "public.promote_hero_catalog_version(uuid)",
    "915422965948bd14037e0f786e5ce215b39ff8599a86a3689b64ffe64e59b1ce",
  ],
  [
    "public.promote_hero_catalog_version(uuid, boolean)",
    "19e498c942204a3f61274f8fba3ecf52f938137b05447b3305ad92cbcea985f9",
  ],
  [
    "public.review_hero_catalog_version(uuid, text, text)",
    "1a0b7212c5f1758b1835578cc65ebf562e6b4a483b83510979b6e6d8f318ab86",
  ],
  [
    "public.rollback_hero_catalog_version(uuid, text)",
    "e22b679944cd5ab21075b7cbd64cda54772325ece04d2cc6d6340a7df4af881e",
  ],
  [
    "public.rollback_hero_catalog_version(uuid, text, boolean)",
    "29fe11664edade1e688d6bcec6d5c601c2c07939ac1348f219940bb051d8c024",
  ],
] as const;

export const APPLICATION_SECURITY_DEFINER_DEFINITION_MANIFEST = [
  [
    "public.asset_dataset_version_is_complete(uuid, uuid)",
    "51b1893ec90e14996021970a265124a5386de7d2a95852c3aa0ee52b8068ae9d",
  ],
  ...WORKER_SECURITY_DEFINER_DEFINITION_MANIFEST,
] as const;

export const CONTROL_TABLE_SHAPE = [
  "singleton:boolean:true",
  "contract_version:smallint:true",
  "instance_id:uuid:true",
  "database_id:uuid:true",
  "environment:text:true",
  "data_class:text:true",
  "database_name:name:true",
  "state:text:true",
  "reset_policy:text:true",
  "migration_role:name:true",
  "worker_role:name:true",
  "web_role:name:true",
  "created_at:timestamp with time zone:true",
] as const;

export const CONTROL_CONSTRAINT_SHAPE = [
  "c:CHECK (contract_version = 1)",
  "c:CHECK (data_class = ANY (ARRAY['sandbox'::text, 'synthetic-fixture'::text, 'production-snapshot'::text, 'live-production'::text]))",
  "c:CHECK (environment = ANY (ARRAY['development'::text, 'test'::text, 'local-review'::text, 'production'::text]))",
  "c:CHECK (reset_policy = ANY (ARRAY['manual'::text, 'run-scoped'::text, 'explicit-rebuild'::text, 'never'::text]))",
  "c:CHECK (singleton)",
  "c:CHECK (state = ANY (ARRAY['active'::text, 'legacy'::text, 'quarantined'::text]))",
  "n:NOT NULL contract_version",
  "n:NOT NULL created_at",
  "n:NOT NULL data_class",
  "n:NOT NULL database_id",
  "n:NOT NULL database_name",
  "n:NOT NULL environment",
  "n:NOT NULL instance_id",
  "n:NOT NULL migration_role",
  "n:NOT NULL reset_policy",
  "n:NOT NULL singleton",
  "n:NOT NULL state",
  "n:NOT NULL web_role",
  "n:NOT NULL worker_role",
  "p:PRIMARY KEY (singleton)",
  "u:UNIQUE (database_id)",
] as const;

function hasAnyApplicationWritePrivilege(
  probe: DatabaseProbeSnapshot,
): boolean {
  return (
    probe.applicationTableDmlPrivileges.length > 0 ||
    probe.applicationColumnDmlPrivileges.length > 0 ||
    probe.applicationSequenceWritePrivileges.length > 0 ||
    probe.applicationSecurityDefinerFunctions.length > 0
  );
}

function assertWorkerPrivilegesAreAllowlisted(
  probe: DatabaseProbeSnapshot,
): void {
  if (
    probe.applicationColumnDmlPrivileges.length > 0 ||
    !isSubset(
      probe.applicationTableDmlPrivileges,
      WORKER_TABLE_DML_ALLOWLIST,
    ) ||
    !isSubset(
      probe.applicationSequenceWritePrivileges,
      WORKER_SEQUENCE_WRITE_ALLOWLIST,
    ) ||
    !isSubset(
      probe.applicationSecurityDefinerFunctions,
      new Set(
        WORKER_SECURITY_DEFINER_DEFINITION_MANIFEST.map(
          ([signature, definitionSha256]) =>
            signature +
            "|" +
            probe.marker.migrationRole +
            '|f|{"search_path=pg_catalog, public"}|' +
            definitionSha256,
        ),
      ),
    )
  ) {
    throw new EnvironmentContractError("ENV_ROLE_PRIVILEGE_DRIFT");
  }
}

function reviewedSecurityDefinerDefinitions(
  migrationRole: string,
): ReadonlySet<string> {
  return new Set(
    APPLICATION_SECURITY_DEFINER_DEFINITION_MANIFEST.map(
      ([signature, definitionSha256]) =>
        signature +
        "|" +
        migrationRole +
        '|f|{"search_path=pg_catalog, public"}|' +
        definitionSha256,
    ),
  );
}

function isSubset(
  actual: readonly string[],
  allowed: ReadonlySet<string>,
): boolean {
  return actual.every((privilege) => allowed.has(privilege));
}

function sameStringArray(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function applicationExtensionsAreAllowlisted(
  actual: readonly string[],
  migrationRole: string,
): boolean {
  return (
    actual.length === 0 ||
    (actual.length === 1 &&
      actual[0] === "pgcrypto|1.4|public|" + migrationRole)
  );
}

function expectedApplicationDefaultPrivileges(migrationRole: string): string[] {
  return [
    migrationRole + "|<global>|T|" + migrationRole + ":USAGE:false",
    migrationRole + "|<global>|f|" + migrationRole + ":EXECUTE:false",
  ].sort();
}

function applicationExtensionMembersAreAllowlisted(
  extensions: readonly string[],
  members: readonly string[],
): boolean {
  if (extensions.length === 0) return members.length === 0;
  return sameStringArray(members, PGCRYPTO_EXTENSION_MEMBER_SIGNATURES);
}

function expectedDatabaseAccessPrivileges(
  roles: Readonly<Record<DatabaseRole, string>>,
): string[] {
  return [
    roles.migration + ":CONNECT:false",
    roles.migration + ":CREATE:false",
    roles.migration + ":TEMPORARY:false",
    roles.web + ":CONNECT:false",
    roles.worker + ":CONNECT:false",
  ].sort();
}

function expectedRuntimeRoleMatrix(
  roles: Readonly<Record<DatabaseRole, string>>,
): string[] {
  return Object.values(roles)
    .map((role) => role + ":false:false:false:false:true:false:false:0")
    .sort();
}

function assertRoleAllowsOperation(
  role: DatabaseRole,
  operation: DatabaseOperation,
): void {
  const allowed: Readonly<Record<DatabaseRole, readonly DatabaseOperation[]>> =
    {
      web: ["read"],
      worker: ["fixture", "import", "review", "promote", "rollback"],
      migration: ["migrate", "seed", "reset"],
    };
  if (!allowed[role].includes(operation)) {
    throw new EnvironmentContractError("ENV_OPERATION_NOT_ALLOWED");
  }
}

function assertEnvironmentAllowsOperation(
  declaration: EnvironmentDeclaration,
  role: DatabaseRole,
  operation: DatabaseOperation,
  resetPolicy: ResetPolicy,
  databaseName: string,
  confirmation: string | null,
): void {
  const allowed = ENVIRONMENT_OPERATION_POLICY[declaration.environment][role];
  if (!allowed.includes(operation)) {
    throw new EnvironmentContractError("ENV_OPERATION_NOT_ALLOWED");
  }
  if (declaration.environment === "test") {
    if (!declaration.runId || resetPolicy !== "run-scoped") {
      throw new EnvironmentContractError(
        "ENV_DESTRUCTIVE_CONFIRMATION_REQUIRED",
      );
    }
    return;
  }
  if (
    declaration.environment === "local-review" &&
    operation === "reset" &&
    resetPolicy !== "explicit-rebuild"
  ) {
    throw new EnvironmentContractError("ENV_DESTRUCTIVE_CONFIRMATION_REQUIRED");
  }
  if (
    declaration.environment === "local-review" &&
    role !== "web" &&
    confirmation !== databaseName
  ) {
    throw new EnvironmentContractError("ENV_DESTRUCTIVE_CONFIRMATION_REQUIRED");
  }
  if (
    declaration.environment === "development" &&
    operation === "reset" &&
    (resetPolicy !== "manual" || confirmation !== databaseName)
  ) {
    throw new EnvironmentContractError("ENV_DESTRUCTIVE_CONFIRMATION_REQUIRED");
  }
}

const ENVIRONMENT_OPERATION_POLICY: Readonly<
  Record<
    RuntimeEnvironment,
    Readonly<Record<DatabaseRole, readonly DatabaseOperation[]>>
  >
> = {
  development: {
    web: ["read"],
    worker: ["import", "review", "promote", "rollback"],
    migration: ["migrate", "reset"],
  },
  test: {
    web: ["read"],
    worker: ["fixture"],
    migration: ["migrate", "seed", "reset"],
  },
  "local-review": {
    web: ["read"],
    worker: ["import", "review", "promote", "rollback"],
    migration: ["migrate", "reset"],
  },
  production: {
    web: ["read"],
    worker: [],
    migration: [],
  },
};

function roleNameFromMarker(
  marker: EnvironmentMarkerSnapshot,
  role: DatabaseRole,
): string {
  if (role === "migration") return marker.migrationRole;
  if (role === "worker") return marker.workerRole;
  return marker.webRole;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "localhost"
  );
}

function isRuntimeEnvironment(value: string): value is RuntimeEnvironment {
  return (
    value === "development" ||
    value === "test" ||
    value === "local-review" ||
    value === "production"
  );
}

function isResetPolicy(value: string): value is ResetPolicy {
  return (
    value === "manual" ||
    value === "run-scoped" ||
    value === "explicit-rebuild" ||
    value === "never"
  );
}
