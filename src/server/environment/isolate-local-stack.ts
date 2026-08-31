import { randomBytes } from "node:crypto";
import pg, { type PoolClient, type QueryResultRow } from "pg";
import {
  readLocalDatabaseControlCredential,
  writeLocalDatabaseControlCredential,
} from "@/config/database-control-credential";
import {
  readLocalDatabaseCredentials,
  writeLocalDatabaseCredentials,
  type LocalDatabaseCredentials,
} from "@/config/database-credentials";
import type { LocalEnvironmentReceipt } from "@/config/environment-receipt";
import { readLocalEnvironmentReceipt } from "@/config/environment-receipt";
import {
  CONTROL_OWNER_ROLE_NAMES_BY_ENVIRONMENT,
  DATABASE_ROLE_NAMES_BY_ENVIRONMENT,
  DATABASE_ROLES,
  type DatabaseRole,
} from "@/domain/environment";
import {
  LOCAL_STACK_DATABASES,
  LOCAL_STACK_ADOPTION_CONFIRMATION,
  type LocalDatabaseName,
} from "./adopt-local-stack";
import {
  APPLICATION_SECURITY_DEFINER_DEFINITION_MANIFEST,
  CONTROL_CONSTRAINT_SHAPE,
  CONTROL_TABLE_SHAPE,
  parseDatabaseEndpoint,
  PGCRYPTO_EXTENSION_MEMBER_SIGNATURES,
  WORKER_SECURITY_DEFINER_DEFINITION_MANIFEST,
} from "./policy";
import { verifyEnvironmentConvergenceWithCredentials } from "./contract";

const { Pool } = pg;
const DEFAULT_LOCAL_CONTROL_ENDPOINT =
  "postgresql://medota2_owner@127.0.0.1:54321/medota2";
const LEGACY_TEMPLATE_ROLES = ["medota2_worker", "medota2_web"] as const;
const LARGE_OBJECT_MUTATION_FUNCTIONS = [
  "pg_catalog.lo_creat(integer)",
  "pg_catalog.lo_create(oid)",
  "pg_catalog.lo_export(oid, text)",
  "pg_catalog.lo_from_bytea(oid, bytea)",
  "pg_catalog.lo_import(text)",
  "pg_catalog.lo_import(text, oid)",
  "pg_catalog.lo_open(oid, integer)",
  "pg_catalog.lo_put(oid, bigint, bytea)",
  "pg_catalog.lo_truncate(integer, integer)",
  "pg_catalog.lo_truncate64(integer, bigint)",
  "pg_catalog.lo_unlink(oid)",
  "pg_catalog.lowrite(integer, bytea)",
  "pg_catalog.pg_logical_emit_message(boolean, text, bytea, boolean)",
  "pg_catalog.pg_logical_emit_message(boolean, text, text, boolean)",
] as const;

interface MarkerRow extends QueryResultRow {
  contract_version: number;
  instance_id: string;
  database_id: string;
  environment: string;
  data_class: string;
  database_name: string;
  reset_policy: string;
  state: string;
  migration_role: string;
  worker_role: string;
  web_role: string;
}

interface SystemRow extends QueryResultRow {
  current_user_name: string;
  session_user_name: string;
  is_superuser: boolean;
  can_login: boolean;
  membership_count: number;
  cluster_superuser_count: number;
  system_identifier: string;
}

interface ControlSessionIdentity {
  username: string;
  systemIdentifier: string;
}

interface ControlShapeRow extends QueryResultRow {
  database_owner: string;
  schema_owner: string;
  relation_owner: string;
  relation_kind: string;
  table_shape: string[];
  constraint_shape: string[];
  user_trigger_count: number;
  user_rule_count: number;
  event_trigger_count: number;
  current_user_name: string;
}

interface TrustedExtensionRow extends QueryResultRow {
  extension_name: string;
  extension_version: string;
  schema_name: string;
  owner_name: string;
}

interface ExtensionDependencyRow extends QueryResultRow {
  dependent_catalog: string;
  dependent_object: string;
}

interface ExtensionMemberRow extends QueryResultRow {
  signature: string;
}

export interface LocalStackIsolationResult {
  receipt: LocalEnvironmentReceipt;
  runtimeCredentialPath: string;
  controlCredentialPath: string;
  changedDatabases: readonly LocalDatabaseName[];
}

export class LocalStackIsolationError extends Error {
  constructor(message: string, cause?: unknown) {
    super("Local database isolation refused: " + message, { cause });
    this.name = "LocalStackIsolationError";
  }
}

async function preflightDatabase(
  client: PoolClient,
  spec: (typeof LOCAL_STACK_DATABASES)[number],
  receipt: LocalEnvironmentReceipt | null,
  bootstrapControlUsername: string,
): Promise<MarkerRow> {
  const marker = await readMarker(client, spec.databaseName);
  assertMarkerSpec(marker, spec);
  if (
    marker.contract_version !== 1 ||
    !["active", "quarantined"].includes(marker.state) ||
    !isUuid(marker.instance_id) ||
    !isUuid(marker.database_id)
  ) {
    throw new LocalStackIsolationError(
      "the control marker is not a valid contract-v1 identity for " +
        spec.databaseName +
        ".",
    );
  }
  const expectedRoles = DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment];
  const legacyRoles = {
    migration: bootstrapControlUsername,
    worker: "medota2_worker",
    web: "medota2_web",
  };
  const markerRoles = [
    marker.migration_role,
    marker.worker_role,
    marker.web_role,
  ].join(":");
  if (
    markerRoles !==
      [expectedRoles.migration, expectedRoles.worker, expectedRoles.web].join(
        ":",
      ) &&
    markerRoles !==
      [legacyRoles.migration, legacyRoles.worker, legacyRoles.web].join(":")
  ) {
    throw new LocalStackIsolationError(
      "the marker has a mixed or unexpected role declaration in " +
        spec.databaseName +
        ".",
    );
  }

  const shape = await client.query<ControlShapeRow>(
    "SELECT pg_catalog.pg_get_userbyid(database.datdba)::text AS database_owner, " +
      "pg_catalog.pg_get_userbyid(namespace.nspowner)::text AS schema_owner, " +
      "pg_catalog.pg_get_userbyid(relation.relowner)::text AS relation_owner, " +
      "relation.relkind::text AS relation_kind, current_user::text AS current_user_name, " +
      "ARRAY(SELECT attribute.attname::text || ':' || pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':' || attribute.attnotnull::text " +
      "FROM pg_catalog.pg_attribute attribute WHERE attribute.attrelid = relation.oid " +
      "AND attribute.attnum > 0 AND NOT attribute.attisdropped ORDER BY attribute.attnum) AS table_shape, " +
      "ARRAY(SELECT constraint_record.contype::text || ':' || pg_catalog.pg_get_constraintdef(constraint_record.oid, true) " +
      "FROM pg_catalog.pg_constraint constraint_record WHERE constraint_record.conrelid = relation.oid " +
      "ORDER BY constraint_record.contype, constraint_record.conname) AS constraint_shape, " +
      "(SELECT pg_catalog.count(*)::int FROM pg_catalog.pg_trigger trigger " +
      "WHERE trigger.tgrelid = relation.oid AND NOT trigger.tgisinternal) AS user_trigger_count, " +
      "(SELECT pg_catalog.count(*)::int FROM pg_catalog.pg_rewrite rewrite " +
      "WHERE rewrite.ev_class = relation.oid AND rewrite.rulename <> '_RETURN') AS user_rule_count, " +
      "(SELECT pg_catalog.count(*)::int FROM pg_catalog.pg_event_trigger) AS event_trigger_count " +
      "FROM pg_catalog.pg_database database JOIN pg_catalog.pg_namespace namespace " +
      "ON namespace.oid = pg_catalog.to_regnamespace('medota2_control') " +
      "JOIN pg_catalog.pg_class relation ON relation.oid = " +
      "pg_catalog.to_regclass('medota2_control.environment_identity') " +
      "WHERE database.datname = pg_catalog.current_database()",
  );
  const row = shape.rows[0];
  const controlOwner =
    CONTROL_OWNER_ROLE_NAMES_BY_ENVIRONMENT[spec.environment];
  if (
    shape.rowCount !== 1 ||
    ![row.current_user_name, expectedRoles.migration].includes(
      row.database_owner,
    ) ||
    ![row.current_user_name, controlOwner].includes(row.schema_owner) ||
    ![row.current_user_name, controlOwner].includes(row.relation_owner) ||
    row.relation_kind !== "r" ||
    row.user_trigger_count !== 0 ||
    row.user_rule_count !== 0 ||
    row.event_trigger_count !== 0 ||
    !sameStrings(row.table_shape, CONTROL_TABLE_SHAPE) ||
    !sameStrings(row.constraint_shape, CONTROL_CONSTRAINT_SHAPE)
  ) {
    throw new LocalStackIsolationError(
      "the database/control shape preflight failed for " +
        spec.databaseName +
        ".",
    );
  }
  if (receipt) {
    const expectedReceipt = receipt.databases[spec.environment];
    if (
      receipt.instanceId !== marker.instance_id ||
      expectedReceipt.databaseId !== marker.database_id ||
      expectedReceipt.databaseName !== marker.database_name ||
      expectedReceipt.dataClass !== marker.data_class
    ) {
      throw new LocalStackIsolationError(
        "the private identity receipt conflicts with " +
          spec.databaseName +
          ".",
      );
    }
  }
  return marker;
}

function assertPreflightIdentitySet(
  markers: ReadonlyMap<LocalDatabaseName, MarkerRow>,
  systemIdentifier: string,
  receipt: LocalEnvironmentReceipt | null,
): void {
  const values = [...markers.values()];
  if (
    values.length !== LOCAL_STACK_DATABASES.length ||
    new Set(values.map((marker) => marker.instance_id)).size !== 1 ||
    new Set(values.map((marker) => marker.database_id)).size !== values.length
  ) {
    throw new LocalStackIsolationError(
      "the database markers do not form one unique three-database identity set.",
    );
  }
  if (receipt && receipt.postgresSystemIdentifier !== systemIdentifier) {
    throw new LocalStackIsolationError(
      "the PostgreSQL system identifier conflicts with the private identity receipt.",
    );
  }
}

export async function isolateLocalStack(input: {
  confirmation: string;
  onProgress?: (message: string) => void;
}): Promise<LocalStackIsolationResult> {
  if (input.confirmation !== LOCAL_STACK_ADOPTION_CONFIRMATION) {
    throw new LocalStackIsolationError(
      "the exact local-stack confirmation is required.",
    );
  }
  const existingControl = readLocalDatabaseControlCredential();
  const explicitRecoveryControlUrl = existingControl
    ? process.env.MEDOTA2_BOOTSTRAP_DATABASE_URL?.trim() || null
    : null;
  const bootstrapControlUrl = existingControl
    ? null
    : resolveBootstrapControlUrl();
  const connectionControlUrl =
    existingControl?.controlUrl ?? bootstrapControlUrl!;
  parseDatabaseEndpoint(connectionControlUrl, "development");
  const desiredControlUrl =
    existingControl?.controlUrl ?? rotateUrlPassword(connectionControlUrl);
  const existingRuntime = readLocalDatabaseCredentials();
  const runtimeCredentials =
    existingRuntime ?? createRuntimeCredentials(desiredControlUrl);
  assertLocalStackCredentialManifest(
    runtimeCredentials,
    desiredControlUrl,
    connectionControlUrl,
  );
  if (explicitRecoveryControlUrl) {
    assertSameControlEndpoint(
      existingControl!.controlUrl,
      explicitRecoveryControlUrl,
    );
  }

  const controlCandidates = existingControl
    ? unique(
        [existingControl.controlUrl, explicitRecoveryControlUrl].filter(
          (value): value is string => Boolean(value),
        ),
      )
    : unique([desiredControlUrl, connectionControlUrl]);
  const expectedControlUsername = currentControlUsername(connectionControlUrl);
  input.onProgress?.("Control preflight: validating the local cluster admin.");
  const control = await connectControl(controlCandidates, "postgres");
  const databaseClients = new Map<LocalDatabaseName, PoolClient>();
  const markers = new Map<LocalDatabaseName, MarkerRow>();
  const changedDatabases: LocalDatabaseName[] = [];
  const identityReceipt = readLocalEnvironmentReceipt();
  let runtimeCredentialPath = "";
  let controlCredentialPath = "";
  let cutoverStarted = false;
  try {
    const controlIdentity = await verifyControlSession(
      control,
      expectedControlUsername,
    );
    await acquireClusterCutoverLock(control);
    const { systemIdentifier } = controlIdentity;
    await assertNoPreparedTransactions(control);
    await assertNoDatabaseEventTriggers(control, "postgres");
    for (const spec of LOCAL_STACK_DATABASES) {
      const client = await connectControl(controlCandidates, spec.databaseName);
      databaseClients.set(spec.databaseName, client);
      const databaseControlIdentity = await verifyControlSession(
        client,
        expectedControlUsername,
      );
      if (databaseControlIdentity.systemIdentifier !== systemIdentifier) {
        throw new LocalStackIsolationError(
          "the database endpoints do not resolve to one PostgreSQL cluster.",
        );
      }
      await assertNoDatabaseEventTriggers(client, spec.databaseName);
      await assertNoExternalDataLinks(client, spec.databaseName);
      await assertReviewedApplicationSemantics(
        client,
        spec,
        controlIdentity.username,
      );
      await assertNoUnreviewedReferentialWritePaths(client, spec);
      await assertReviewedAclPrincipals(
        client,
        spec,
        controlIdentity.username,
        false,
      );
      await assertReviewedDefaultPrivileges(client, spec, false);
      const marker = await preflightDatabase(
        client,
        spec,
        identityReceipt,
        controlIdentity.username,
      );
      markers.set(spec.databaseName, marker);
    }
    assertPreflightIdentitySet(markers, systemIdentifier, identityReceipt);

    for (const spec of LOCAL_STACK_DATABASES) {
      await databaseClients
        .get(spec.databaseName)!
        .query("SELECT pg_catalog.pg_advisory_lock(1296389170, 1162627397)");
    }

    // Persist recovery material only after every read-only preflight succeeds,
    // but before any role password changes. A partial cutover is resumable and
    // remains quarantined.
    runtimeCredentialPath = writeLocalDatabaseCredentials(runtimeCredentials);
    controlCredentialPath = writeLocalDatabaseControlCredential({
      contractVersion: 1,
      controlUrl: desiredControlUrl,
    });
    cutoverStarted = true;
    await setBusinessDatabaseConnections(control, false);
    for (const spec of LOCAL_STACK_DATABASES) {
      const client = databaseClients.get(spec.databaseName)!;
      await client.query(
        "UPDATE medota2_control.environment_identity SET state = 'quarantined' " +
          "WHERE singleton = true AND state IN ('active', 'quarantined')",
      );
    }
    await terminateCutoverSessions(
      control,
      [control, ...databaseClients.values()],
      controlIdentity.username,
    );
    await disableKnownRuntimeLogins(control);
    await control.query(
      "ALTER ROLE " +
        quoteIdentifier(controlIdentity.username) +
        " PASSWORD " +
        quoteLiteral(decodeURIComponent(new URL(desiredControlUrl).password)),
    );
    await provisionGlobalRoles(control, runtimeCredentials);
    await disableLegacyRuntimeAccess(control);
    await alterDatabaseOwners(control);

    for (const spec of LOCAL_STACK_DATABASES) {
      input.onProgress?.(
        "Isolating " + spec.databaseName + " as " + spec.environment + ".",
      );
      const marker = markers.get(spec.databaseName)!;
      const changed = await isolateDatabase(
        databaseClients.get(spec.databaseName)!,
        spec,
        marker,
      );
      if (changed) changedDatabases.push(spec.databaseName);
    }

    await control.query(
      "REVOKE CONNECT, TEMPORARY ON DATABASE postgres, template1 FROM PUBLIC",
    );
    for (const spec of LOCAL_STACK_DATABASES) {
      await assertReviewedDefaultPrivileges(
        databaseClients.get(spec.databaseName)!,
        spec,
        true,
      );
      await assertReviewedAclPrincipals(
        databaseClients.get(spec.databaseName)!,
        spec,
        controlIdentity.username,
        true,
      );
    }
    input.onProgress?.(
      "Postflight: proving role identity and cross-environment CONNECT denial.",
    );
    await setBusinessDatabaseConnections(control, true);
    await enableRuntimeAccess(control, runtimeCredentials);
    await verifyRuntimeRoleMatrix(runtimeCredentials, systemIdentifier);
    await verifyCrossEnvironmentConnectDenial(
      runtimeCredentials,
      controlCandidates,
    );
    for (const spec of LOCAL_STACK_DATABASES) {
      const marker = markers.get(spec.databaseName)!;
      await verifyEnvironmentConvergenceWithCredentials({
        declaration: {
          contractVersion: 1,
          environment: spec.environment,
          dataClass: spec.dataClass,
          runId: spec.environment === "test" ? "adoption-postflight" : null,
          expectedInstanceId: marker.instance_id,
          expectedDatabaseId: marker.database_id,
          expectedPostgresSystemIdentifier: systemIdentifier,
        },
        expectedRoleNames: DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment],
        databaseUrls: runtimeCredentials.databases[spec.environment],
        expectedMarkerState: "quarantined",
      });
    }
    await disableKnownRuntimeLogins(control);
    await terminateCutoverSessions(
      control,
      [control, ...databaseClients.values()],
      controlIdentity.username,
    );

    for (const spec of LOCAL_STACK_DATABASES) {
      await databaseClients
        .get(spec.databaseName)!
        .query(
          "UPDATE medota2_control.environment_identity SET state = 'active' " +
            "WHERE singleton = true AND state = 'quarantined'",
        );
    }
    await enableRuntimeAccess(control, runtimeCredentials);
    for (const spec of LOCAL_STACK_DATABASES) {
      const marker = markers.get(spec.databaseName)!;
      await verifyEnvironmentConvergenceWithCredentials({
        declaration: {
          contractVersion: 1,
          environment: spec.environment,
          dataClass: spec.dataClass,
          runId: spec.environment === "test" ? "adoption-postflight" : null,
          expectedInstanceId: marker.instance_id,
          expectedDatabaseId: marker.database_id,
          expectedPostgresSystemIdentifier: systemIdentifier,
        },
        expectedRoleNames: DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment],
        databaseUrls: runtimeCredentials.databases[spec.environment],
      });
    }

    const instanceId = markers.get("medota2")!.instance_id;
    return {
      runtimeCredentialPath,
      controlCredentialPath,
      changedDatabases,
      receipt: {
        contractVersion: 1,
        instanceId,
        postgresSystemIdentifier: systemIdentifier,
        databases: {
          development: {
            databaseId: markers.get("medota2")!.database_id,
            databaseName: "medota2",
            dataClass: "sandbox",
          },
          test: {
            databaseId: markers.get("medota2_test")!.database_id,
            databaseName: "medota2_test",
            dataClass: "synthetic-fixture",
          },
          "local-review": {
            databaseId: markers.get("medota2_local")!.database_id,
            databaseName: "medota2_local",
            dataClass: "production-snapshot",
          },
        },
      },
    };
  } catch (error) {
    if (cutoverStarted) {
      try {
        await quarantineAfterFailedCutover(
          control,
          databaseClients,
          runtimeCredentials,
          expectedControlUsername,
        );
      } catch (recoveryError) {
        throw new LocalStackIsolationError(
          "cutover failed and the recovery quarantine could not be fully proven; " +
            "keep applications stopped and perform manual recovery before trusting the stack.",
          new AggregateError([error, recoveryError]),
        );
      }
    }
    throw error;
  } finally {
    for (const client of databaseClients.values()) client.release();
    control.release();
  }
}

function createRuntimeCredentials(
  controlUrl: string,
): LocalDatabaseCredentials {
  const databases = Object.fromEntries(
    LOCAL_STACK_DATABASES.map((spec) => {
      const roleNames = DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment];
      return [
        spec.environment,
        Object.fromEntries(
          DATABASE_ROLES.map((role) => [
            role,
            buildRoleUrl(
              controlUrl,
              spec.databaseName,
              roleNames[role],
              randomPassword(),
            ),
          ]),
        ),
      ];
    }),
  ) as LocalDatabaseCredentials["databases"];
  return { contractVersion: 1, databases };
}

export function assertLocalStackCredentialManifest(
  credentials: LocalDatabaseCredentials,
  controlUrl: string,
  legacyControlUrl: string,
): void {
  const control = new URL(controlUrl);
  const legacy = new URL(legacyControlUrl);
  const controlEndpoint = parseDatabaseEndpoint(controlUrl, "development");
  const legacyEndpoint = parseDatabaseEndpoint(legacyControlUrl, "development");
  if (
    control.search ||
    control.hash ||
    legacy.search ||
    legacy.hash ||
    controlEndpoint.username !== legacyEndpoint.username ||
    controlEndpoint.hostname !== legacyEndpoint.hostname ||
    controlEndpoint.port !== legacyEndpoint.port ||
    controlEndpoint.databaseName !== legacyEndpoint.databaseName ||
    decodeURIComponent(control.password).length < 32
  ) {
    throw new LocalStackIsolationError(
      "the control credential does not match the exact local bootstrap endpoint policy.",
    );
  }

  const seenUrls = new Set<string>();
  const seenPasswords = new Set<string>();
  const forbiddenPasswords = new Set([
    decodeURIComponent(control.password),
    decodeURIComponent(legacy.password),
  ]);
  for (const spec of LOCAL_STACK_DATABASES) {
    const expectedRoles = DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment];
    for (const role of DATABASE_ROLES) {
      const rawUrl = credentials.databases[spec.environment][role];
      const parsed = new URL(rawUrl);
      const endpoint = parseDatabaseEndpoint(rawUrl, spec.environment);
      const password = decodeURIComponent(parsed.password);
      if (
        parsed.search ||
        parsed.hash ||
        endpoint.username !== expectedRoles[role] ||
        endpoint.databaseName !== spec.databaseName ||
        endpoint.hostname !== controlEndpoint.hostname ||
        endpoint.port !== controlEndpoint.port ||
        password.length < 32 ||
        forbiddenPasswords.has(password) ||
        seenUrls.has(rawUrl) ||
        seenPasswords.has(password)
      ) {
        throw new LocalStackIsolationError(
          "the runtime credential manifest is not a unique environment/role matrix.",
        );
      }
      seenUrls.add(rawUrl);
      seenPasswords.add(password);
    }
  }
}

async function provisionGlobalRoles(
  client: PoolClient,
  credentials: LocalDatabaseCredentials,
): Promise<void> {
  for (const template of LEGACY_TEMPLATE_ROLES) {
    await ensureRole(client, template, { login: false });
    await revokeAllMemberships(client, template);
  }
  for (const spec of LOCAL_STACK_DATABASES) {
    const controlOwner =
      CONTROL_OWNER_ROLE_NAMES_BY_ENVIRONMENT[spec.environment];
    await ensureRole(client, controlOwner, { login: false });
    await revokeAllMemberships(client, controlOwner);
    for (const role of DATABASE_ROLES) {
      const url = credentials.databases[spec.environment][role];
      const parsed = new URL(url);
      await ensureRole(client, decodeURIComponent(parsed.username), {
        login: false,
        password: decodeURIComponent(parsed.password),
      });
      await revokeAllMemberships(client, decodeURIComponent(parsed.username));
    }
  }
}

async function enableRuntimeAccess(
  client: PoolClient,
  credentials: LocalDatabaseCredentials,
): Promise<void> {
  for (const spec of LOCAL_STACK_DATABASES) {
    for (const role of DATABASE_ROLES) {
      const parsed = new URL(credentials.databases[spec.environment][role]);
      await ensureRole(client, decodeURIComponent(parsed.username), {
        login: true,
        password: decodeURIComponent(parsed.password),
      });
    }
  }
}

async function disableKnownRuntimeLogins(client: PoolClient): Promise<void> {
  const roles = allLocalRuntimeRoles();
  for (const role of roles) {
    const exists = await client.query(
      "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
      [role],
    );
    if (!exists.rowCount) continue;
    await client.query("ALTER ROLE " + quoteIdentifier(role) + " NOLOGIN");
    await revokeAllMemberships(client, role);
  }
}

async function quarantineAfterFailedCutover(
  control: PoolClient,
  databaseClients: ReadonlyMap<LocalDatabaseName, PoolClient>,
  credentials: LocalDatabaseCredentials,
  controlUsername: string,
): Promise<void> {
  const failures: unknown[] = [];
  const attempt = async (operation: () => Promise<unknown>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      failures.push(error);
    }
  };

  await attempt(() => setBusinessDatabaseConnections(control, false));
  for (const client of databaseClients.values()) {
    await attempt(() =>
      client.query(
        "UPDATE medota2_control.environment_identity SET state = 'quarantined' " +
          "WHERE singleton = true AND state IN ('active', 'quarantined')",
      ),
    );
  }
  await attempt(() =>
    terminateCutoverSessions(
      control,
      [control, ...databaseClients.values()],
      controlUsername,
    ),
  );
  await attempt(() => disableKnownRuntimeLogins(control));
  await attempt(() => provisionGlobalRoles(control, credentials));
  await attempt(() => disableLegacyRuntimeAccess(control));
  for (const spec of LOCAL_STACK_DATABASES) {
    await attempt(() => reconcileDatabaseAccess(control, spec));
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "recovery quarantine did not converge");
  }
  await setBusinessDatabaseConnections(control, true);
}

async function alterDatabaseOwners(client: PoolClient): Promise<void> {
  for (const spec of LOCAL_STACK_DATABASES) {
    const migration =
      DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment].migration;
    await client.query(
      "ALTER DATABASE " +
        quoteIdentifier(spec.databaseName) +
        " OWNER TO " +
        quoteIdentifier(migration),
    );
  }
}

async function setBusinessDatabaseConnections(
  client: PoolClient,
  allowed: boolean,
): Promise<void> {
  for (const spec of LOCAL_STACK_DATABASES) {
    await client.query(
      "ALTER DATABASE " +
        quoteIdentifier(spec.databaseName) +
        " ALLOW_CONNECTIONS " +
        (allowed ? "true" : "false"),
    );
  }
}

async function reconcileDatabaseAccess(
  client: PoolClient,
  spec: (typeof LOCAL_STACK_DATABASES)[number],
): Promise<void> {
  const observed = await client.query<{ role_name: string }>(
    "SELECT DISTINCT role_name FROM (" +
      "SELECT pg_catalog.pg_get_userbyid(database.datdba)::text AS role_name " +
      "FROM pg_catalog.pg_database database WHERE database.datname = $1 UNION ALL " +
      "SELECT CASE WHEN access.grantee = 0 THEN 'PUBLIC' ELSE " +
      "pg_catalog.pg_get_userbyid(access.grantee)::text END AS role_name " +
      "FROM pg_catalog.pg_database database CROSS JOIN LATERAL " +
      "pg_catalog.aclexplode(database.datacl) access WHERE database.datname = $1" +
      ") principals WHERE role_name IS NOT NULL ORDER BY role_name",
    [spec.databaseName],
  );
  const candidates = unique([
    ...observed.rows.map((row) => row.role_name),
    ...allLocalRuntimeRoles(),
    ...Object.values(CONTROL_OWNER_ROLE_NAMES_BY_ENVIRONMENT),
  ]).filter((role) => role !== "PUBLIC");
  const existing = await client.query<{ role_name: string }>(
    "SELECT rolname::text AS role_name FROM pg_catalog.pg_roles " +
      "WHERE rolname = ANY($1::text[]) ORDER BY rolname",
    [candidates],
  );
  await client.query(
    "REVOKE ALL PRIVILEGES ON DATABASE " +
      quoteIdentifier(spec.databaseName) +
      " FROM PUBLIC" +
      (existing.rowCount
        ? ", " +
          existing.rows.map((row) => quoteIdentifier(row.role_name)).join(", ")
        : ""),
  );
  const roles = DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment];
  await client.query(
    "GRANT CONNECT, CREATE, TEMPORARY ON DATABASE " +
      quoteIdentifier(spec.databaseName) +
      " TO " +
      quoteIdentifier(roles.migration),
  );
  await client.query(
    "GRANT CONNECT ON DATABASE " +
      quoteIdentifier(spec.databaseName) +
      " TO " +
      [roles.worker, roles.web].map(quoteIdentifier).join(", "),
  );
}

async function isolateDatabase(
  client: PoolClient,
  spec: (typeof LOCAL_STACK_DATABASES)[number],
  markerBefore: MarkerRow,
): Promise<boolean> {
  await client.query("BEGIN");
  try {
    const changed = await applyDatabaseIsolation(client, spec, markerBefore);
    await client.query("COMMIT");
    return changed;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function applyDatabaseIsolation(
  client: PoolClient,
  spec: (typeof LOCAL_STACK_DATABASES)[number],
  markerBefore: MarkerRow,
): Promise<boolean> {
  const roles = DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment];
  const controlOwner =
    CONTROL_OWNER_ROLE_NAMES_BY_ENVIRONMENT[spec.environment];
  const alreadyIsolated =
    markerBefore.migration_role === roles.migration &&
    markerBefore.worker_role === roles.worker &&
    markerBefore.web_role === roles.web;

  await client.query(
    "UPDATE medota2_control.environment_identity SET migration_role = $1, " +
      "worker_role = $2, web_role = $3 WHERE singleton = true AND state = 'quarantined'",
    [roles.migration, roles.worker, roles.web],
  );

  await assertNoUnexpectedOwnedObjects(client);
  await transferApplicationOwnership(client, roles.migration);
  await reinstallTrustedApplicationExtensions(client, roles.migration);
  await reconcileLegacyRuntimeAcl(client, roles.worker, roles.web);

  const allRuntimeRoles = allLocalRuntimeRoles();
  await reconcileDatabaseAccess(client, spec);

  await client.query(
    "ALTER SCHEMA medota2_control OWNER TO " + quoteIdentifier(controlOwner),
  );
  await client.query(
    "ALTER TABLE medota2_control.environment_identity OWNER TO " +
      quoteIdentifier(controlOwner),
  );
  const legacyAndRuntimeRoles = unique([
    ...allRuntimeRoles,
    ...LEGACY_TEMPLATE_ROLES,
  ]);
  await client.query(
    "REVOKE ALL ON SCHEMA medota2_control FROM PUBLIC, " +
      legacyAndRuntimeRoles.map(quoteIdentifier).join(", "),
  );
  await client.query(
    "REVOKE ALL ON medota2_control.environment_identity FROM PUBLIC, " +
      legacyAndRuntimeRoles.map(quoteIdentifier).join(", "),
  );
  await client.query(
    "GRANT USAGE ON SCHEMA medota2_control TO " +
      DATABASE_ROLES.map((role) => quoteIdentifier(roles[role])).join(", "),
  );
  await client.query(
    "GRANT SELECT ON medota2_control.environment_identity TO " +
      DATABASE_ROLES.map((role) => quoteIdentifier(roles[role])).join(", "),
  );
  await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");

  const revokeLargeObjects =
    "REVOKE EXECUTE ON FUNCTION " +
    LARGE_OBJECT_MUTATION_FUNCTIONS.join(", ") +
    " FROM PUBLIC, " +
    legacyAndRuntimeRoles.map(quoteIdentifier).join(", ");
  await client.query(revokeLargeObjects);

  await client.query(
    "ALTER DEFAULT PRIVILEGES FOR ROLE " +
      quoteIdentifier(roles.migration) +
      " REVOKE ALL ON TABLES FROM PUBLIC",
  );
  await client.query(
    "ALTER DEFAULT PRIVILEGES FOR ROLE " +
      quoteIdentifier(roles.migration) +
      " REVOKE ALL ON SEQUENCES FROM PUBLIC",
  );
  await client.query(
    "ALTER DEFAULT PRIVILEGES FOR ROLE " +
      quoteIdentifier(roles.migration) +
      " REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC",
  );
  await client.query(
    "ALTER DEFAULT PRIVILEGES FOR ROLE " +
      quoteIdentifier(roles.migration) +
      " REVOKE USAGE ON TYPES FROM PUBLIC",
  );
  await client.query(
    "ALTER ROLE " +
      quoteIdentifier(roles.web) +
      " IN DATABASE " +
      quoteIdentifier(spec.databaseName) +
      " SET default_transaction_read_only TO on",
  );
  for (const role of [roles.migration, roles.worker]) {
    await client.query(
      "ALTER ROLE " +
        quoteIdentifier(role) +
        " IN DATABASE " +
        quoteIdentifier(spec.databaseName) +
        " SET default_transaction_read_only TO off",
    );
  }

  return !alreadyIsolated;
}

async function transferApplicationOwnership(
  client: PoolClient,
  migrationRole: string,
): Promise<void> {
  const relations = await client.query<{
    schema_name: string;
    object_name: string;
    relation_kind: string;
  }>(
    "SELECT namespace.nspname AS schema_name, object.relname AS object_name, " +
      "object.relkind::text AS relation_kind FROM pg_catalog.pg_class object " +
      "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace " +
      "JOIN pg_catalog.pg_roles owner ON owner.oid = object.relowner " +
      "WHERE namespace.nspname = 'public' AND owner.rolname = current_user " +
      "AND object.relkind IN ('r','p','v','m','f') " +
      "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency " +
      "WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass " +
      "AND dependency.objid = object.oid AND dependency.deptype = 'e') " +
      "ORDER BY object.relkind, object.relname",
  );
  for (const relation of relations.rows) {
    const command =
      relation.relation_kind === "v"
        ? "ALTER VIEW"
        : relation.relation_kind === "m"
          ? "ALTER MATERIALIZED VIEW"
          : relation.relation_kind === "f"
            ? "ALTER FOREIGN TABLE"
            : "ALTER TABLE";
    await client.query(
      command +
        " " +
        quoteQualified(relation.schema_name, relation.object_name) +
        " OWNER TO " +
        quoteIdentifier(migrationRole),
    );
  }

  const standaloneSequences = await client.query<{
    schema_name: string;
    object_name: string;
  }>(
    "SELECT namespace.nspname AS schema_name, sequence.relname AS object_name " +
      "FROM pg_catalog.pg_class sequence JOIN pg_catalog.pg_namespace namespace " +
      "ON namespace.oid = sequence.relnamespace JOIN pg_catalog.pg_roles owner " +
      "ON owner.oid = sequence.relowner WHERE namespace.nspname = 'public' " +
      "AND owner.rolname = current_user AND sequence.relkind = 'S' " +
      "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency " +
      "WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass " +
      "AND dependency.objid = sequence.oid " +
      "AND dependency.refclassid = 'pg_catalog.pg_class'::pg_catalog.regclass " +
      "AND dependency.deptype IN ('a', 'i')) ORDER BY sequence.relname",
  );
  for (const sequence of standaloneSequences.rows) {
    await client.query(
      "ALTER SEQUENCE " +
        quoteQualified(sequence.schema_name, sequence.object_name) +
        " OWNER TO " +
        quoteIdentifier(migrationRole),
    );
  }

  const routines = await client.query<{
    identity: string;
    routine_kind: string;
  }>(
    "SELECT routine.oid::pg_catalog.regprocedure::text AS identity, " +
      "routine.prokind::text AS routine_kind FROM pg_catalog.pg_proc routine " +
      "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace " +
      "JOIN pg_catalog.pg_roles owner ON owner.oid = routine.proowner " +
      "WHERE namespace.nspname = 'public' AND owner.rolname = current_user " +
      "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency " +
      "WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass " +
      "AND dependency.objid = routine.oid AND dependency.deptype = 'e') " +
      "ORDER BY routine.oid",
  );
  for (const routine of routines.rows) {
    if (routine.routine_kind === "a") {
      throw new LocalStackIsolationError(
        "an application aggregate requires explicit ownership review: " +
          routine.identity,
      );
    }
    const keyword = routine.routine_kind === "p" ? "PROCEDURE" : "FUNCTION";
    await client.query(
      "ALTER " +
        keyword +
        " " +
        routine.identity +
        " OWNER TO " +
        quoteIdentifier(migrationRole),
    );
  }
  await client.query(
    "DO $isolation$ DECLARE routine record; BEGIN " +
      "FOR routine IN SELECT object.oid::pg_catalog.regprocedure::text AS identity " +
      "FROM pg_catalog.pg_proc object JOIN pg_catalog.pg_namespace namespace " +
      "ON namespace.oid = object.pronamespace WHERE namespace.nspname = 'public' " +
      "AND object.prosecdef LOOP EXECUTE format('ALTER FUNCTION %s SET search_path TO pg_catalog, public', " +
      "routine.identity); END LOOP; END $isolation$",
  );

  const types = await client.query<{ identity: string; type_kind: string }>(
    "SELECT pg_catalog.format_type(type.oid, NULL) AS identity, type.typtype::text AS type_kind " +
      "FROM pg_catalog.pg_type type JOIN pg_catalog.pg_namespace namespace " +
      "ON namespace.oid = type.typnamespace JOIN pg_catalog.pg_roles owner " +
      "ON owner.oid = type.typowner WHERE namespace.nspname = 'public' " +
      "AND owner.rolname = current_user AND type.typtype IN ('d','e') " +
      "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency " +
      "WHERE dependency.classid = 'pg_catalog.pg_type'::pg_catalog.regclass " +
      "AND dependency.objid = type.oid AND dependency.deptype = 'e') ORDER BY type.oid",
  );
  for (const type of types.rows) {
    await client.query(
      "ALTER " +
        (type.type_kind === "d" ? "DOMAIN " : "TYPE ") +
        type.identity +
        " OWNER TO " +
        quoteIdentifier(migrationRole),
    );
  }
}

async function reinstallTrustedApplicationExtensions(
  client: PoolClient,
  migrationRole: string,
): Promise<void> {
  const extension = await client.query<TrustedExtensionRow>(
    "SELECT extension.extname::text AS extension_name, " +
      "extension.extversion::text AS extension_version, " +
      "namespace.nspname::text AS schema_name, " +
      "pg_catalog.pg_get_userbyid(extension.extowner)::text AS owner_name " +
      "FROM pg_catalog.pg_extension extension JOIN pg_catalog.pg_namespace namespace " +
      "ON namespace.oid = extension.extnamespace WHERE extension.extname = 'pgcrypto'",
  );
  if (extension.rowCount === 0) return;
  const row = extension.rows[0]!;
  if (
    extension.rowCount !== 1 ||
    row.extension_version !== "1.4" ||
    row.schema_name !== "public"
  ) {
    throw new LocalStackIsolationError(
      "pgcrypto is not the expected public version 1.4 extension.",
    );
  }

  const members = await client.query<ExtensionMemberRow>(
    "SELECT CASE WHEN member.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass " +
      "AND member.objsubid = 0 THEN 'pg_proc|' || namespace.nspname::text || '.' || " +
      "routine.proname::text || '(' || " +
      "pg_catalog.pg_get_function_identity_arguments(routine.oid) || ')' ELSE " +
      "member.classid::pg_catalog.regclass::text || '|' || " +
      "pg_catalog.pg_describe_object(member.classid, member.objid, member.objsubid) END AS signature " +
      "FROM pg_catalog.pg_depend member JOIN pg_catalog.pg_extension extension " +
      "ON extension.oid = member.refobjid LEFT JOIN pg_catalog.pg_proc routine " +
      "ON member.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass " +
      "AND routine.oid = member.objid LEFT JOIN pg_catalog.pg_namespace namespace " +
      "ON namespace.oid = routine.pronamespace WHERE member.deptype = 'e' " +
      "AND extension.extname = 'pgcrypto' ORDER BY signature",
  );
  if (
    !sameStrings(
      members.rows.map((member) => member.signature),
      PGCRYPTO_EXTENSION_MEMBER_SIGNATURES,
    )
  ) {
    throw new LocalStackIsolationError(
      "pgcrypto contains an object outside the reviewed PostgreSQL 18 / extension 1.4 member inventory.",
    );
  }

  const dependencies = await client.query<ExtensionDependencyRow>(
    "SELECT dependent.classid::pg_catalog.regclass::text AS dependent_catalog, " +
      "pg_catalog.pg_describe_object(dependent.classid, dependent.objid, dependent.objsubid) " +
      "AS dependent_object FROM pg_catalog.pg_depend member " +
      "JOIN pg_catalog.pg_extension extension ON extension.oid = member.refobjid " +
      "JOIN pg_catalog.pg_depend dependent ON dependent.refclassid = member.classid " +
      "AND dependent.refobjid = member.objid AND dependent.refobjsubid = member.objsubid " +
      "WHERE member.deptype = 'e' AND extension.extname = 'pgcrypto' " +
      "AND NOT (dependent.classid = member.classid AND dependent.objid = member.objid " +
      "AND dependent.deptype = 'e') ORDER BY dependent_catalog, dependent_object",
  );
  const dependencySignatures = dependencies.rows.map(
    (dependency) =>
      dependency.dependent_catalog + "|" + dependency.dependent_object,
  );
  const expectedConstraintDependency =
    "pg_constraint|constraint asset_blobs_content_sha256_matches_content on table asset_blobs";
  if (
    dependencySignatures.length > 1 ||
    (dependencySignatures.length === 1 &&
      dependencySignatures[0] !== expectedConstraintDependency)
  ) {
    throw new LocalStackIsolationError(
      "pgcrypto has an application dependency outside the reviewed asset checksum constraint.",
    );
  }
  if (row.owner_name === migrationRole) return;

  const currentRole = await client.query<{ role_name: string }>(
    "SELECT current_user::text AS role_name",
  );
  if (row.owner_name !== currentRole.rows[0]!.role_name) {
    throw new LocalStackIsolationError(
      "pgcrypto is owned by an unexpected role and cannot be safely transferred.",
    );
  }

  if (dependencySignatures.length === 1) {
    const constraint = await client.query<{
      definition: string;
      owner_name: string;
    }>(
      "SELECT pg_catalog.pg_get_constraintdef(constraint_record.oid, true) AS definition, " +
        "pg_catalog.pg_get_userbyid(relation.relowner)::text AS owner_name " +
        "FROM pg_catalog.pg_constraint constraint_record JOIN pg_catalog.pg_class relation " +
        "ON relation.oid = constraint_record.conrelid JOIN pg_catalog.pg_namespace namespace " +
        "ON namespace.oid = relation.relnamespace WHERE namespace.nspname = 'public' " +
        "AND relation.relname = 'asset_blobs' " +
        "AND constraint_record.conname = 'asset_blobs_content_sha256_matches_content'",
    );
    if (
      constraint.rowCount !== 1 ||
      constraint.rows[0]!.owner_name !== migrationRole ||
      constraint.rows[0]!.definition !==
        "CHECK (encode(digest(content, 'sha256'::text), 'hex'::text) = content_sha256)"
    ) {
      throw new LocalStackIsolationError(
        "the pgcrypto-dependent asset checksum constraint does not match the reviewed definition.",
      );
    }
    await client.query(
      "ALTER TABLE public.asset_blobs DROP CONSTRAINT asset_blobs_content_sha256_matches_content",
    );
  }

  await client.query("DROP EXTENSION pgcrypto");
  await client.query("SET LOCAL ROLE " + quoteIdentifier(migrationRole));
  await client.query("CREATE EXTENSION pgcrypto WITH SCHEMA public");
  if (dependencySignatures.length === 1) {
    await client.query(
      "ALTER TABLE public.asset_blobs ADD CONSTRAINT " +
        "asset_blobs_content_sha256_matches_content CHECK " +
        "(pg_catalog.encode(public.digest(content, 'sha256'), 'hex') = content_sha256)",
    );
  }
  await client.query("RESET ROLE");

  const converged = await client.query<TrustedExtensionRow>(
    "SELECT extension.extname::text AS extension_name, " +
      "extension.extversion::text AS extension_version, " +
      "namespace.nspname::text AS schema_name, " +
      "pg_catalog.pg_get_userbyid(extension.extowner)::text AS owner_name " +
      "FROM pg_catalog.pg_extension extension JOIN pg_catalog.pg_namespace namespace " +
      "ON namespace.oid = extension.extnamespace WHERE extension.extname = 'pgcrypto'",
  );
  if (
    converged.rowCount !== 1 ||
    converged.rows[0]!.extension_version !== "1.4" ||
    converged.rows[0]!.schema_name !== "public" ||
    converged.rows[0]!.owner_name !== migrationRole
  ) {
    throw new LocalStackIsolationError(
      "pgcrypto ownership did not converge to the environment migrator.",
    );
  }
}

async function reconcileLegacyRuntimeAcl(
  client: PoolClient,
  workerRole: string,
  webRole: string,
): Promise<void> {
  for (const [legacyRole, targetRole] of [
    ["medota2_worker", workerRole],
    ["medota2_web", webRole],
  ] as const) {
    const tableGrants = await client.query<{
      schema_name: string;
      object_name: string;
      privilege_type: string;
    }>(
      "SELECT table_schema AS schema_name, table_name AS object_name, privilege_type " +
        "FROM information_schema.role_table_grants WHERE grantee = $1 " +
        "AND table_schema = 'public' ORDER BY table_name, privilege_type",
      [legacyRole],
    );
    for (const grant of tableGrants.rows) {
      await client.query(
        "GRANT " +
          grant.privilege_type +
          " ON TABLE " +
          quoteQualified(grant.schema_name, grant.object_name) +
          " TO " +
          quoteIdentifier(targetRole),
      );
    }
    const sequenceGrants = await client.query<{
      schema_name: string;
      object_name: string;
      privilege_type: string;
    }>(
      "SELECT object_schema AS schema_name, object_name, privilege_type " +
        "FROM information_schema.role_usage_grants WHERE grantee = $1 " +
        "AND object_type = 'SEQUENCE' AND object_schema = 'public' ORDER BY object_name",
      [legacyRole],
    );
    for (const grant of sequenceGrants.rows) {
      await client.query(
        "GRANT " +
          grant.privilege_type +
          " ON SEQUENCE " +
          quoteQualified(grant.schema_name, grant.object_name) +
          " TO " +
          quoteIdentifier(targetRole),
      );
    }
    const routineGrants = await client.query<{
      identity: string;
      definition_sha256: string;
    }>(
      "SELECT namespace.nspname::text || '.' || routine.proname::text || '(' || " +
        "pg_catalog.oidvectortypes(routine.proargtypes) || ')' AS identity, " +
        "pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(" +
        "pg_catalog.pg_get_functiondef(routine.oid), 'UTF8')), 'hex') AS definition_sha256 " +
        "FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace " +
        "ON namespace.oid = routine.pronamespace WHERE namespace.nspname = 'public' " +
        "AND pg_catalog.has_function_privilege($1, routine.oid, 'EXECUTE') " +
        "AND routine.prosecdef ORDER BY routine.oid",
      [legacyRole],
    );
    const reviewedRoutineDefinitions = new Set(
      (targetRole === workerRole
        ? WORKER_SECURITY_DEFINER_DEFINITION_MANIFEST
        : []
      ).map(
        ([identity, definitionSha256]) => identity + "|" + definitionSha256,
      ),
    );
    for (const grant of routineGrants.rows) {
      if (
        !reviewedRoutineDefinitions.has(
          grant.identity + "|" + grant.definition_sha256,
        )
      ) {
        throw new LocalStackIsolationError(
          "legacy runtime EXECUTE reaches an unreviewed security-definer routine.",
        );
      }
      await client.query(
        "GRANT EXECUTE ON FUNCTION " +
          grant.identity +
          " TO " +
          quoteIdentifier(targetRole),
      );
    }
    const columnGrants = await client.query<{
      schema_name: string;
      object_name: string;
      column_name: string;
      privilege_type: string;
    }>(
      "SELECT table_schema AS schema_name, table_name AS object_name, " +
        "column_name, privilege_type FROM information_schema.column_privileges " +
        "WHERE grantee = $1 AND table_schema = 'public' " +
        "ORDER BY table_name, column_name, privilege_type",
      [legacyRole],
    );
    for (const grant of columnGrants.rows) {
      if (
        !["SELECT", "INSERT", "UPDATE", "REFERENCES"].includes(
          grant.privilege_type,
        )
      ) {
        throw new LocalStackIsolationError(
          "a legacy role has an unexpected column privilege.",
        );
      }
      await client.query(
        "REVOKE " +
          grant.privilege_type +
          " (" +
          quoteIdentifier(grant.column_name) +
          ") ON TABLE " +
          quoteQualified(grant.schema_name, grant.object_name) +
          " FROM " +
          quoteIdentifier(legacyRole),
      );
    }
  }
  await client.query(
    "REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM medota2_worker, medota2_web",
  );
  await client.query(
    "REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM medota2_worker, medota2_web",
  );
  await client.query(
    "REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM medota2_worker, medota2_web",
  );
  await client.query(
    "REVOKE USAGE ON SCHEMA public FROM medota2_worker, medota2_web",
  );
}

async function assertNoUnexpectedOwnedObjects(
  client: PoolClient,
): Promise<void> {
  const largeObjects = await client.query<{ count: number }>(
    "SELECT pg_catalog.count(*)::pg_catalog.int4 AS count FROM pg_catalog.pg_largeobject_metadata",
  );
  if (largeObjects.rows[0]!.count !== 0) {
    throw new LocalStackIsolationError(
      "large objects exist and require an explicit keep/delete ownership decision.",
    );
  }
  const legacyOwners = await client.query<{ count: number }>(
    "SELECT (" +
      "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_class object JOIN pg_catalog.pg_roles owner ON owner.oid=object.relowner " +
      "JOIN pg_catalog.pg_namespace namespace ON namespace.oid=object.relnamespace WHERE namespace.nspname NOT IN ('pg_catalog','information_schema') " +
      "AND owner.rolname IN ('medota2_worker','medota2_web')) + " +
      "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc object JOIN pg_catalog.pg_roles owner ON owner.oid=object.proowner " +
      "JOIN pg_catalog.pg_namespace namespace ON namespace.oid=object.pronamespace WHERE namespace.nspname NOT IN ('pg_catalog','information_schema') " +
      "AND owner.rolname IN ('medota2_worker','medota2_web')) + " +
      "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_namespace object JOIN pg_catalog.pg_roles owner ON owner.oid=object.nspowner " +
      "WHERE object.nspname NOT IN ('pg_catalog','information_schema') " +
      "AND object.nspname !~ '^pg_(toast|temp)(_|$)' AND owner.rolname IN ('medota2_worker','medota2_web')) + " +
      "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_type object JOIN pg_catalog.pg_roles owner ON owner.oid=object.typowner " +
      "JOIN pg_catalog.pg_namespace namespace ON namespace.oid=object.typnamespace WHERE namespace.nspname NOT IN ('pg_catalog','information_schema') " +
      "AND owner.rolname IN ('medota2_worker','medota2_web')) + " +
      "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_extension object JOIN pg_catalog.pg_roles owner ON owner.oid=object.extowner " +
      "WHERE owner.rolname IN ('medota2_worker','medota2_web')) + " +
      "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_largeobject_metadata object JOIN pg_catalog.pg_roles owner ON owner.oid=object.lomowner " +
      "WHERE owner.rolname IN ('medota2_worker','medota2_web')))::pg_catalog.int4 AS count",
  );
  if (legacyOwners.rows[0]!.count !== 0) {
    throw new LocalStackIsolationError(
      "a legacy runtime role owns application objects; ownership needs manual review.",
    );
  }
}

async function disableLegacyRuntimeAccess(client: PoolClient): Promise<void> {
  for (const role of LEGACY_TEMPLATE_ROLES) {
    await client.query(
      "ALTER ROLE " +
        quoteIdentifier(role) +
        " NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS",
    );
    await client.query(
      "SELECT pg_catalog.pg_terminate_backend(activity.pid) FROM pg_catalog.pg_stat_activity activity " +
        "WHERE activity.usename = $1 AND activity.pid <> pg_catalog.pg_backend_pid()",
      [role],
    );
  }
}

async function terminateCutoverSessions(
  client: PoolClient,
  allowedClients: readonly PoolClient[],
  controlUsername: string,
): Promise<void> {
  const allowedPids = await Promise.all(
    allowedClients.map(async (allowedClient) => {
      const result = await allowedClient.query<{ pid: number }>(
        "SELECT pg_catalog.pg_backend_pid()::int AS pid",
      );
      return result.rows[0]!.pid;
    }),
  );
  await client.query(
    "SELECT pg_catalog.pg_terminate_backend(activity.pid) " +
      "FROM pg_catalog.pg_stat_activity activity WHERE " +
      "(activity.datname = ANY($1::text[]) OR activity.usename = $2 OR " +
      "activity.usename = ANY($3::text[])) AND NOT (activity.pid = ANY($4::int[]))",
    [
      LOCAL_STACK_DATABASES.map((spec) => spec.databaseName),
      controlUsername,
      allLocalRuntimeRoles(),
      allowedPids,
    ],
  );
}

async function verifyRuntimeRoleMatrix(
  credentials: LocalDatabaseCredentials,
  expectedSystemIdentifier: string,
): Promise<void> {
  for (const spec of LOCAL_STACK_DATABASES) {
    const expected = DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment];
    for (const role of DATABASE_ROLES) {
      const pool = new Pool({
        connectionString: credentials.databases[spec.environment][role],
        max: 1,
        connectionTimeoutMillis: 5_000,
      });
      try {
        const result = await pool.query<{
          database_name: string;
          current_user_name: string;
          session_user_name: string;
          system_identifier: string;
          marker_role: string;
          database_owner: string;
          database_access_privileges: string[];
        }>(
          "SELECT pg_catalog.current_database()::text AS database_name, " +
            "current_user::text AS current_user_name, session_user::text AS session_user_name, " +
            "(SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier, " +
            "(SELECT pg_catalog.pg_get_userbyid(database.datdba)::text " +
            "FROM pg_catalog.pg_database database WHERE database.datname = " +
            "pg_catalog.current_database()) AS database_owner, " +
            "ARRAY(SELECT (CASE WHEN access.grantee = 0 THEN 'PUBLIC' ELSE " +
            "pg_catalog.pg_get_userbyid(access.grantee)::text END) || ':' || " +
            "access.privilege_type || ':' || access.is_grantable::text " +
            "FROM pg_catalog.pg_database database CROSS JOIN LATERAL " +
            "pg_catalog.aclexplode(COALESCE(database.datacl, " +
            "pg_catalog.acldefault('d', database.datdba))) access " +
            "WHERE database.datname = pg_catalog.current_database() " +
            "AND access.privilege_type IN ('CREATE', 'CONNECT', 'TEMPORARY') " +
            "ORDER BY 1) AS database_access_privileges, " +
            (role === "migration"
              ? "marker.migration_role::text"
              : role === "worker"
                ? "marker.worker_role::text"
                : "marker.web_role::text") +
            " AS marker_role FROM medota2_control.environment_identity marker WHERE singleton = true AND state = 'quarantined'",
        );
        const row = result.rows[0];
        if (
          result.rowCount !== 1 ||
          row.database_name !== spec.databaseName ||
          row.current_user_name !== expected[role] ||
          row.session_user_name !== expected[role] ||
          row.marker_role !== expected[role] ||
          row.database_owner !== expected.migration ||
          !sameStrings(
            row.database_access_privileges,
            expectedDatabaseAccessPrivileges(expected),
          ) ||
          row.system_identifier !== expectedSystemIdentifier
        ) {
          throw new LocalStackIsolationError(
            "runtime role postflight mismatch for " + spec.databaseName + ".",
          );
        }
      } finally {
        await pool.end();
      }
    }
  }
}

async function verifyCrossEnvironmentConnectDenial(
  credentials: LocalDatabaseCredentials,
  controlCandidates: readonly string[],
): Promise<void> {
  const control = await connectControl(controlCandidates, "postgres");
  let targetDatabases: string[];
  try {
    const result = await control.query<{ database_name: string }>(
      "SELECT datname::text AS database_name FROM pg_catalog.pg_database " +
        "WHERE datallowconn AND datname <> 'template0' ORDER BY datname",
    );
    targetDatabases = result.rows.map((row) => row.database_name);
  } finally {
    control.release();
  }
  for (const source of LOCAL_STACK_DATABASES) {
    for (const role of DATABASE_ROLES) {
      const sourceUrl = credentials.databases[source.environment][role];
      for (const targetDatabase of targetDatabases) {
        if (targetDatabase === source.databaseName) continue;
        const pool = new Pool({
          connectionString: replaceDatabaseName(sourceUrl, targetDatabase),
          max: 1,
          connectionTimeoutMillis: 1_500,
        });
        try {
          await pool.query("SELECT 1");
          throw new LocalStackIsolationError(
            source.environment +
              " " +
              role +
              " can CONNECT to " +
              targetDatabase +
              ".",
          );
        } catch (error) {
          if (error instanceof LocalStackIsolationError) throw error;
          if (!isPostgresErrorCode(error, "42501")) {
            throw new LocalStackIsolationError(
              "the cross-environment CONNECT probe was inconclusive for " +
                targetDatabase +
                ".",
              error,
            );
          }
        } finally {
          await pool.end().catch(() => undefined);
        }
      }
    }
  }
}

async function readMarker(
  client: PoolClient,
  expectedDatabase: LocalDatabaseName,
): Promise<MarkerRow> {
  const result = await client.query<MarkerRow>(
    "SELECT contract_version, instance_id::text, database_id::text, environment, data_class, " +
      "database_name::text, state, reset_policy, migration_role::text, worker_role::text, " +
      "web_role::text FROM medota2_control.environment_identity " +
      "WHERE singleton = true",
  );
  if (
    result.rowCount !== 1 ||
    result.rows[0]!.database_name !== expectedDatabase
  ) {
    throw new LocalStackIsolationError(
      "a valid pre-existing environment marker is required for " +
        expectedDatabase +
        ".",
    );
  }
  return result.rows[0]!;
}

function assertMarkerSpec(
  marker: MarkerRow,
  spec: (typeof LOCAL_STACK_DATABASES)[number],
): void {
  if (
    marker.environment !== spec.environment ||
    marker.data_class !== spec.dataClass ||
    marker.database_name !== spec.databaseName ||
    marker.reset_policy !== spec.resetPolicy
  ) {
    throw new LocalStackIsolationError(
      "the marker conflicts with " +
        spec.databaseName +
        " environment classification.",
    );
  }
}

async function connectControl(
  candidates: readonly string[],
  databaseName: string,
): Promise<PoolClient> {
  for (const candidate of candidates) {
    const pool = new Pool({
      connectionString: replaceDatabaseName(candidate, databaseName),
      max: 1,
      connectionTimeoutMillis: 5_000,
    });
    try {
      const client = await pool.connect();
      const originalRelease = client.release.bind(client);
      client.release = ((error?: Error | boolean) => {
        originalRelease(error);
        void pool.end();
      }) as PoolClient["release"];
      return client;
    } catch {
      await pool.end().catch(() => undefined);
    }
  }
  throw new LocalStackIsolationError(
    "the private control credential and legacy bootstrap fallback both failed.",
  );
}

async function verifyControlSession(
  client: PoolClient,
  expectedUsername: string,
): Promise<ControlSessionIdentity> {
  const result = await client.query<SystemRow>(
    "SELECT current_user::text AS current_user_name, " +
      "session_user::text AS session_user_name, role.rolsuper AS is_superuser, " +
      "role.rolcanlogin AS can_login, " +
      "(SELECT pg_catalog.count(*)::int FROM pg_catalog.pg_auth_members membership " +
      "WHERE membership.roleid = role.oid OR membership.member = role.oid) AS membership_count, " +
      "(SELECT pg_catalog.count(*)::int FROM pg_catalog.pg_roles candidate " +
      "WHERE candidate.rolsuper) AS cluster_superuser_count, " +
      "(SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS system_identifier " +
      "FROM pg_catalog.pg_roles role WHERE role.rolname = current_user",
  );
  const row = result.rows[0];
  if (
    result.rowCount !== 1 ||
    row.current_user_name !== expectedUsername ||
    row.session_user_name !== expectedUsername ||
    !row.is_superuser ||
    !row.can_login ||
    row.membership_count !== 0 ||
    row.cluster_superuser_count !== 1
  ) {
    throw new LocalStackIsolationError(
      "the control credential is not a singular cluster administrator.",
    );
  }
  return {
    username: row.current_user_name,
    systemIdentifier: row.system_identifier,
  };
}

async function assertNoPreparedTransactions(client: PoolClient): Promise<void> {
  const result = await client.query<{ count: number }>(
    "SELECT pg_catalog.count(*)::int AS count FROM pg_catalog.pg_prepared_xacts",
  );
  if (result.rows[0]!.count !== 0) {
    throw new LocalStackIsolationError(
      "prepared transactions exist in the cluster and require an explicit commit/rollback decision.",
    );
  }
}

async function acquireClusterCutoverLock(client: PoolClient): Promise<void> {
  const result = await client.query<{ acquired: boolean }>(
    "SELECT pg_catalog.pg_try_advisory_lock(1296389170, 1162627396) AS acquired",
  );
  if (result.rowCount !== 1 || !result.rows[0]!.acquired) {
    throw new LocalStackIsolationError(
      "another local-stack cutover already holds the cluster control lock.",
    );
  }
}

async function assertNoExternalDataLinks(
  client: PoolClient,
  databaseName: LocalDatabaseName,
): Promise<void> {
  const result = await client.query<{ findings: string[] }>(
    "SELECT ARRAY(SELECT finding FROM (" +
      "SELECT 'foreign-data-wrapper:' || fdwname::text AS finding FROM pg_catalog.pg_foreign_data_wrapper " +
      "UNION ALL SELECT 'foreign-server:' || srvname::text FROM pg_catalog.pg_foreign_server " +
      "UNION ALL SELECT 'user-mapping:' || oid::text FROM pg_catalog.pg_user_mapping " +
      "UNION ALL SELECT 'foreign-table:' || ftrelid::pg_catalog.regclass::text FROM pg_catalog.pg_foreign_table " +
      "UNION ALL SELECT 'publication:' || pubname::text FROM pg_catalog.pg_publication " +
      "UNION ALL SELECT 'subscription:' || subname::text FROM pg_catalog.pg_subscription " +
      "UNION ALL SELECT 'replication-slot:' || slot_name::text FROM pg_catalog.pg_replication_slots " +
      "WHERE database = pg_catalog.current_database() " +
      "UNION ALL SELECT 'replication-origin:' || roname::text " +
      "FROM pg_catalog.pg_replication_origin" +
      ") external_links ORDER BY finding) AS findings",
  );
  if (result.rows[0]!.findings.length !== 0) {
    throw new LocalStackIsolationError(
      "external/replication data links exist in " +
        databaseName +
        " and require an explicit data-boundary review.",
    );
  }
}

async function assertReviewedApplicationSemantics(
  client: PoolClient,
  spec: (typeof LOCAL_STACK_DATABASES)[number],
  controlUsername: string,
): Promise<void> {
  const routines = await client.query<{
    identity: string;
    owner_name: string;
    routine_kind: string;
    security_definer: boolean;
    configuration: string;
    definition_sha256: string;
  }>(
    "SELECT namespace.nspname::text || '.' || routine.proname::text || '(' || " +
      "pg_catalog.oidvectortypes(routine.proargtypes) || ')' AS identity, " +
      "pg_catalog.pg_get_userbyid(routine.proowner)::text AS owner_name, " +
      "routine.prokind::text AS routine_kind, " +
      "routine.prosecdef AS security_definer, " +
      "COALESCE(routine.proconfig::text, '{}') AS configuration, " +
      "pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(" +
      "pg_catalog.pg_get_functiondef(routine.oid), 'UTF8')), 'hex') AS definition_sha256 " +
      "FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace " +
      "ON namespace.oid = routine.pronamespace " +
      "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' " +
      "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency " +
      "WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass " +
      "AND dependency.objid = routine.oid AND dependency.deptype = 'e') ORDER BY identity",
  );
  const reviewed = new Map<string, string>(
    APPLICATION_SECURITY_DEFINER_DEFINITION_MANIFEST,
  );
  const expectedMigrationRole =
    DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment].migration;
  for (const routine of routines.rows) {
    if (
      reviewed.get(routine.identity) !== routine.definition_sha256 ||
      !routine.security_definer ||
      ![controlUsername, expectedMigrationRole].includes(routine.owner_name) ||
      routine.routine_kind !== "f" ||
      routine.configuration !== '{"search_path=pg_catalog, public"}'
    ) {
      throw new LocalStackIsolationError(
        "an application security-definer routine is outside the reviewed definition manifest in " +
          spec.databaseName +
          ".",
      );
    }
  }

  const automation = await client.query<{ finding: string }>(
    "SELECT finding FROM (" +
      "SELECT 'trigger:' || namespace.nspname::text || '.' || relation.relname::text || ':' || " +
      "trigger.tgname::text AS finding FROM pg_catalog.pg_trigger trigger " +
      "JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid " +
      "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace " +
      "WHERE NOT trigger.tgisinternal AND namespace.nspname NOT IN " +
      "('pg_catalog', 'information_schema') " +
      "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' UNION ALL " +
      "SELECT 'rule:' || namespace.nspname::text || '.' || relation.relname::text || ':' || " +
      "rewrite.rulename::text AS finding FROM pg_catalog.pg_rewrite rewrite " +
      "JOIN pg_catalog.pg_class relation ON relation.oid = rewrite.ev_class " +
      "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace " +
      "WHERE rewrite.rulename <> '_RETURN' AND namespace.nspname NOT IN " +
      "('pg_catalog', 'information_schema') " +
      "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' UNION ALL " +
      "SELECT 'routing:' || child_namespace.nspname::text || '.' || child.relname::text || " +
      "'->' || parent_namespace.nspname::text || '.' || parent.relname::text AS finding " +
      "FROM pg_catalog.pg_inherits inheritance " +
      "JOIN pg_catalog.pg_class child ON child.oid = inheritance.inhrelid " +
      "JOIN pg_catalog.pg_namespace child_namespace ON child_namespace.oid = child.relnamespace " +
      "JOIN pg_catalog.pg_class parent ON parent.oid = inheritance.inhparent " +
      "JOIN pg_catalog.pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace " +
      "WHERE child_namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
      "AND child_namespace.nspname !~ '^pg_(toast|temp)(_|$)') findings ORDER BY finding",
  );
  if (automation.rowCount) {
    throw new LocalStackIsolationError(
      "unreviewed application triggers or rules exist in " +
        spec.databaseName +
        ".",
    );
  }
}

async function assertNoUnreviewedReferentialWritePaths(
  client: PoolClient,
  spec: (typeof LOCAL_STACK_DATABASES)[number],
): Promise<void> {
  const candidateWorkers = unique([
    "medota2_worker",
    DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment].worker,
  ]);
  for (const workerRole of candidateWorkers) {
    const exists = await client.query(
      "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
      [workerRole],
    );
    if (!exists.rowCount) continue;
    const result = await client.query<{ finding: string }>(
      "SELECT finding FROM (" +
        "SELECT 'delete-cascade:' || parent.oid::pg_catalog.regclass::text || '->' || " +
        "child.oid::pg_catalog.regclass::text || ':' || constraint_record.conname::text AS finding " +
        "FROM pg_catalog.pg_constraint constraint_record " +
        "JOIN pg_catalog.pg_class child ON child.oid = constraint_record.conrelid " +
        "JOIN pg_catalog.pg_class parent ON parent.oid = constraint_record.confrelid " +
        "WHERE constraint_record.contype = 'f' AND constraint_record.confdeltype = 'c' " +
        "AND pg_catalog.has_table_privilege($1, parent.oid, 'DELETE') " +
        "AND NOT pg_catalog.has_table_privilege($1, child.oid, 'DELETE') " +
        "UNION ALL SELECT 'delete-update:' || parent.oid::pg_catalog.regclass::text || '->' || " +
        "child.oid::pg_catalog.regclass::text || ':' || constraint_record.conname::text " +
        "FROM pg_catalog.pg_constraint constraint_record " +
        "JOIN pg_catalog.pg_class child ON child.oid = constraint_record.conrelid " +
        "JOIN pg_catalog.pg_class parent ON parent.oid = constraint_record.confrelid " +
        "WHERE constraint_record.contype = 'f' AND constraint_record.confdeltype IN ('n', 'd') " +
        "AND pg_catalog.has_table_privilege($1, parent.oid, 'DELETE') " +
        "AND NOT pg_catalog.has_table_privilege($1, child.oid, 'UPDATE') " +
        "UNION ALL SELECT 'update-cascade:' || parent.oid::pg_catalog.regclass::text || '->' || " +
        "child.oid::pg_catalog.regclass::text || ':' || constraint_record.conname::text " +
        "FROM pg_catalog.pg_constraint constraint_record " +
        "JOIN pg_catalog.pg_class child ON child.oid = constraint_record.conrelid " +
        "JOIN pg_catalog.pg_class parent ON parent.oid = constraint_record.confrelid " +
        "WHERE constraint_record.contype = 'f' AND constraint_record.confupdtype IN ('c', 'n', 'd') " +
        "AND pg_catalog.has_table_privilege($1, parent.oid, 'UPDATE') " +
        "AND NOT pg_catalog.has_table_privilege($1, child.oid, 'UPDATE')" +
        ") paths ORDER BY finding",
      [workerRole],
    );
    if (result.rowCount) {
      throw new LocalStackIsolationError(
        "foreign-key referential actions expand " +
          workerRole +
          " write privileges in " +
          spec.databaseName +
          ".",
      );
    }
  }
}

async function assertReviewedDefaultPrivileges(
  client: PoolClient,
  spec: (typeof LOCAL_STACK_DATABASES)[number],
  requireCanonical: boolean,
): Promise<void> {
  const result = await client.query<{ finding: string }>(
    "SELECT owner.rolname::text || '|' || " +
      "COALESCE(namespace.nspname::text, '<global>') || '|' || " +
      "defaults.defaclobjtype::text || '|' || " +
      "(CASE WHEN access.grantee = 0 THEN 'PUBLIC' ELSE " +
      "pg_catalog.pg_get_userbyid(access.grantee)::text END) || ':' || " +
      "access.privilege_type || ':' || access.is_grantable::text AS finding " +
      "FROM pg_catalog.pg_default_acl defaults JOIN pg_catalog.pg_roles owner " +
      "ON owner.oid = defaults.defaclrole LEFT JOIN pg_catalog.pg_namespace namespace " +
      "ON namespace.oid = defaults.defaclnamespace CROSS JOIN LATERAL " +
      "pg_catalog.aclexplode(defaults.defaclacl) access ORDER BY finding",
  );
  const migration =
    DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment].migration;
  const expected = [
    migration + "|<global>|T|" + migration + ":USAGE:false",
    migration + "|<global>|f|" + migration + ":EXECUTE:false",
  ].sort();
  const actual = result.rows.map((row) => row.finding);
  if (
    sameStrings(actual, expected) ||
    (!requireCanonical && actual.length === 0)
  ) {
    return;
  }
  throw new LocalStackIsolationError(
    "default privileges are not the reviewed " +
      spec.environment +
      " application shape in " +
      spec.databaseName +
      ".",
  );
}

async function assertReviewedAclPrincipals(
  client: PoolClient,
  spec: (typeof LOCAL_STACK_DATABASES)[number],
  controlUsername: string,
  strictEnvironmentOnly: boolean,
): Promise<void> {
  const result = await client.query<{ principal: string }>(
    "WITH principals AS (" +
      "SELECT access.grantor, access.grantee FROM pg_catalog.pg_database object " +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(object.datacl) access " +
      "WHERE object.datname = pg_catalog.current_database() UNION ALL " +
      "SELECT access.grantor, access.grantee FROM pg_catalog.pg_namespace object " +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(object.nspacl) access " +
      "WHERE object.nspname IN ('public', 'medota2_control') UNION ALL " +
      "SELECT access.grantor, access.grantee FROM pg_catalog.pg_class object " +
      "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace " +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(object.relacl) access " +
      "WHERE namespace.nspname IN ('public', 'medota2_control') UNION ALL " +
      "SELECT access.grantor, access.grantee FROM pg_catalog.pg_attribute attribute " +
      "JOIN pg_catalog.pg_class object ON object.oid = attribute.attrelid " +
      "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace " +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) access " +
      "WHERE namespace.nspname IN ('public', 'medota2_control') UNION ALL " +
      "SELECT access.grantor, access.grantee FROM pg_catalog.pg_proc object " +
      "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.pronamespace " +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(object.proacl) access " +
      "WHERE namespace.nspname IN ('public', 'medota2_control') UNION ALL " +
      "SELECT access.grantor, access.grantee FROM pg_catalog.pg_type object " +
      "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.typnamespace " +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(object.typacl) access " +
      "WHERE namespace.nspname IN ('public', 'medota2_control') UNION ALL " +
      "SELECT access.grantor, access.grantee FROM pg_catalog.pg_largeobject_metadata object " +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(object.lomacl) access UNION ALL " +
      "SELECT access.grantor, access.grantee FROM pg_catalog.pg_default_acl object " +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(object.defaclacl) access UNION ALL " +
      "SELECT access.grantor, access.grantee FROM pg_catalog.pg_foreign_server object " +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(object.srvacl) access UNION ALL " +
      "SELECT access.grantor, access.grantee FROM pg_catalog.pg_foreign_data_wrapper object " +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(object.fdwacl) access UNION ALL " +
      "SELECT access.grantor, access.grantee FROM pg_catalog.pg_parameter_acl object " +
      "CROSS JOIN LATERAL pg_catalog.aclexplode(object.paracl) access), " +
      "role_oids AS (SELECT grantor AS oid FROM principals UNION SELECT grantee FROM principals) " +
      "SELECT DISTINCT CASE WHEN oid = 0 THEN 'PUBLIC' ELSE " +
      "pg_catalog.pg_get_userbyid(oid)::text END AS principal FROM role_oids ORDER BY principal",
  );
  const roles = DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment];
  const allowed = new Set(
    strictEnvironmentOnly
      ? [
          "PUBLIC",
          "pg_database_owner",
          controlUsername,
          CONTROL_OWNER_ROLE_NAMES_BY_ENVIRONMENT[spec.environment],
          ...Object.values(roles),
        ]
      : [
          "PUBLIC",
          "pg_database_owner",
          controlUsername,
          ...allLocalRuntimeRoles(),
          ...Object.values(CONTROL_OWNER_ROLE_NAMES_BY_ENVIRONMENT),
        ],
  );
  const unexpected = result.rows
    .map((row) => row.principal)
    .filter((principal) => !allowed.has(principal));
  if (unexpected.length > 0) {
    throw new LocalStackIsolationError(
      "unreviewed ACL principals exist in " + spec.databaseName + ".",
    );
  }
}

async function assertNoDatabaseEventTriggers(
  client: PoolClient,
  databaseName: string,
): Promise<void> {
  const result = await client.query<{ count: number }>(
    "SELECT pg_catalog.count(*)::pg_catalog.int4 AS count " +
      "FROM pg_catalog.pg_event_trigger",
  );
  if (result.rows[0]!.count !== 0) {
    throw new LocalStackIsolationError(
      "unreviewed event triggers exist in " + databaseName + ".",
    );
  }
}

async function ensureRole(
  client: PoolClient,
  role: string,
  options: { login: boolean; password?: string },
): Promise<void> {
  assertIdentifier(role);
  const exists = await client.query(
    "SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1",
    [role],
  );
  if (!exists.rowCount) {
    await client.query("CREATE ROLE " + quoteIdentifier(role));
  }
  await client.query(
    "ALTER ROLE " +
      quoteIdentifier(role) +
      (options.login ? " LOGIN" : " NOLOGIN") +
      " NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS" +
      (options.password ? " PASSWORD " + quoteLiteral(options.password) : ""),
  );
}

async function revokeAllMemberships(
  client: PoolClient,
  role: string,
): Promise<void> {
  const memberships = await client.query<{
    granted_role: string;
    member_role: string;
  }>(
    "SELECT granted.rolname AS granted_role, member.rolname AS member_role " +
      "FROM pg_catalog.pg_auth_members membership " +
      "JOIN pg_catalog.pg_roles granted ON granted.oid = membership.roleid " +
      "JOIN pg_catalog.pg_roles member ON member.oid = membership.member " +
      "WHERE granted.rolname = $1 OR member.rolname = $1",
    [role],
  );
  for (const membership of memberships.rows) {
    await client.query(
      "REVOKE " +
        quoteIdentifier(membership.granted_role) +
        " FROM " +
        quoteIdentifier(membership.member_role),
    );
  }
}

function buildRoleUrl(
  controlUrl: string,
  databaseName: string,
  username: string,
  password: string,
): string {
  const parsed = new URL(controlUrl);
  parsed.username = username;
  parsed.password = password;
  parsed.pathname = "/" + databaseName;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function resolveBootstrapControlUrl(): string {
  const explicit = process.env.MEDOTA2_BOOTSTRAP_DATABASE_URL?.trim();
  if (explicit) return explicit;
  const password = process.env.MEDOTA2_POSTGRES_BOOTSTRAP_PASSWORD?.trim();
  if (!password || password.length < 32) {
    throw new LocalStackIsolationError(
      "export MEDOTA2_POSTGRES_BOOTSTRAP_PASSWORD with at least 32 characters, " +
        "or provide MEDOTA2_BOOTSTRAP_DATABASE_URL for a pre-existing legacy stack.",
    );
  }
  const parsed = new URL(DEFAULT_LOCAL_CONTROL_ENDPOINT);
  parsed.password = password;
  return parsed.toString();
}

function assertSameControlEndpoint(
  primaryUrl: string,
  recoveryUrl: string,
): void {
  const primary = new URL(primaryUrl);
  const recovery = new URL(recoveryUrl);
  const primaryEndpoint = parseDatabaseEndpoint(primaryUrl, "development");
  const recoveryEndpoint = parseDatabaseEndpoint(recoveryUrl, "development");
  if (
    primary.search ||
    primary.hash ||
    recovery.search ||
    recovery.hash ||
    primaryEndpoint.username !== recoveryEndpoint.username ||
    primaryEndpoint.hostname !== recoveryEndpoint.hostname ||
    primaryEndpoint.port !== recoveryEndpoint.port ||
    primaryEndpoint.databaseName !== recoveryEndpoint.databaseName
  ) {
    throw new LocalStackIsolationError(
      "the explicit recovery credential does not match the private control endpoint.",
    );
  }
}

function rotateUrlPassword(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  parsed.password = randomPassword();
  return parsed.toString();
}

function replaceDatabaseName(rawUrl: string, databaseName: string): string {
  const parsed = new URL(rawUrl);
  parsed.pathname = "/" + databaseName;
  return parsed.toString();
}

function currentControlUsername(rawUrl: string): string {
  const username = decodeURIComponent(new URL(rawUrl).username);
  assertIdentifier(username);
  return username;
}

function randomPassword(): string {
  return randomBytes(32).toString("base64url");
}

function quoteIdentifier(identifier: string): string {
  assertIdentifier(identifier);
  return '"' + identifier.replaceAll('"', '""') + '"';
}

function quoteQualified(schema: string, object: string): string {
  return quoteIdentifier(schema) + "." + quoteIdentifier(object);
}

function quoteLiteral(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

function assertIdentifier(identifier: string): void {
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(identifier)) {
    throw new LocalStackIsolationError("invalid PostgreSQL identifier.");
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function allLocalRuntimeRoles(): string[] {
  return unique([
    ...LEGACY_TEMPLATE_ROLES,
    ...LOCAL_STACK_DATABASES.flatMap((spec) =>
      DATABASE_ROLES.map(
        (role) => DATABASE_ROLE_NAMES_BY_ENVIRONMENT[spec.environment][role],
      ),
    ),
  ]);
}

function sameStrings(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function isPostgresErrorCode(error: unknown, code: string): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code,
  );
}
