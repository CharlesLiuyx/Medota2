import pg, {
  type PoolClient,
  type QueryConfig,
  type QueryResult,
  type QueryResultRow,
} from "pg";
import {
  assertProcessMayUseDatabaseRole,
  getEnvironmentDatabaseUrl,
  getEnvironmentDeclaration,
  getExpectedDatabaseRoleName,
} from "@/config/env";
import type {
  DatabaseIdentity,
  DatabaseOperation,
  DatabaseRole,
  DeclaredPublicEnvironmentIdentity,
  EnvironmentDeclaration,
  VerifiedPublicEnvironmentIdentity,
} from "@/domain/environment";
import {
  CONTROL_OWNER_ROLE_NAMES_BY_ENVIRONMENT,
  DATABASE_ROLES,
} from "@/domain/environment";
import {
  attestEnvironment,
  EnvironmentContractError,
  parseDatabaseEndpoint,
  type DatabaseProbeSnapshot,
  type EnvironmentMarkerSnapshot,
  type ParsedDatabaseEndpoint,
} from "./policy";

const { Pool } = pg;
const verifiedDatabaseBrand: unique symbol = Symbol("VerifiedDatabase");
const verifiedSessionBrand: unique symbol = Symbol("VerifiedSession");

export interface VerifiedSession {
  readonly [verifiedSessionBrand]: true;
  query: PoolClient["query"];
  release(error?: Error | boolean): void;
}

interface VerifiedDatabaseBase<
  Operation extends DatabaseOperation = DatabaseOperation,
> {
  readonly [verifiedDatabaseBrand]: true;
  readonly identity: DatabaseIdentity;
  readonly role: DatabaseRole;
  readonly operation: Operation;
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
  verifyIdentity(): Promise<DatabaseIdentity>;
  end(): Promise<void>;
}

export type VerifiedDatabase<
  Operation extends DatabaseOperation = DatabaseOperation,
> = VerifiedDatabaseBase<Operation> &
  (Operation extends "read"
    ? Record<never, never>
    : { connect(): Promise<VerifiedSession> });

type WorkerMutationOperation = Extract<
  DatabaseOperation,
  "fixture" | "import" | "review" | "promote" | "rollback"
>;
type MigrationOperation = Extract<
  DatabaseOperation,
  "migrate" | "seed" | "reset"
>;

export type OpenVerifiedDatabaseOptions =
  | { role: "web"; operation: "read"; confirmation?: string }
  | {
      role: "worker";
      operation: WorkerMutationOperation;
      confirmation?: string;
    }
  | {
      role: "migration";
      operation: MigrationOperation;
      confirmation?: string;
    };

interface InternalOpenVerifiedDatabaseOptions<
  Operation extends DatabaseOperation = DatabaseOperation,
> {
  role: DatabaseRole;
  operation: Operation;
  confirmation?: string;
  authorizeOperation: boolean;
  rawUrl?: string;
  expectedMarkerState?: "active" | "quarantined";
}

interface ProbeRow extends QueryResultRow {
  database_name: string;
  current_user_name: string;
  session_user_name: string;
  server_address: string | null;
  server_port: number | null;
  in_recovery: boolean;
  transaction_read_only: boolean;
  role_superuser: boolean;
  role_create_database: boolean;
  role_create_role: boolean;
  role_inherit: boolean;
  role_login: boolean;
  role_replication: boolean;
  role_bypass_rls: boolean;
  role_membership_count: number;
  expected_role_matrix: string[];
  role_has_control_write: boolean;
  database_owner: string;
  database_access_privileges: string[];
  accessible_other_databases: string[];
  control_schema_owner: string | null;
  control_relation_owner: string | null;
  control_relation_kind: string | null;
  control_table_shape: string[];
  control_constraint_shape: string[];
  control_owner_is_isolated: boolean;
  role_has_application_ddl: boolean;
  role_has_application_grant_options: boolean;
  application_default_privileges: string[];
  application_extensions: string[];
  application_extension_members: string[];
  external_data_link_count: number;
  prepared_transaction_count: number;
  unexpected_application_object_owners: string[];
  application_table_dml_privileges: string[];
  application_column_dml_privileges: string[];
  application_sequence_write_privileges: string[];
  application_security_definer_functions: string[];
  application_security_definer_inventory: string[];
  application_invoker_routines: string[];
  application_automation_objects: string[];
  application_referential_write_paths: string[];
  parameter_privileges: string[];
  dangerous_builtin_functions: string[];
  large_object_privileges: string[];
  role_owns_large_objects: boolean;
  postgres_system_identifier: string;
  search_path: string;
  row_security: string;
  session_replication_role: string;
  default_transaction_read_only: string;
}

interface RoleGuardRow extends QueryResultRow {
  current_user_name: string;
  session_user_name: string;
}

interface MarkerRow extends QueryResultRow {
  contract_version: number;
  instance_id: string;
  database_id: string;
  environment: string;
  data_class: string;
  database_name: string;
  state: string;
  reset_policy: string;
  migration_role: string;
  worker_role: string;
  web_role: string;
}

interface RuntimeDatabaseContext {
  declaration: EnvironmentDeclaration;
  expectedRoleNames: Readonly<Record<DatabaseRole, string>>;
}

export async function openVerifiedDatabase<
  const Options extends OpenVerifiedDatabaseOptions,
>(options: Options): Promise<VerifiedDatabase<Options["operation"]>> {
  try {
    assertProcessMayUseDatabaseRole(options.role);
  } catch (error) {
    throw new EnvironmentContractError("ENV_CONFIGURATION_INVALID", error);
  }
  const context = resolveRuntimeDatabaseContext();
  const database = await openSingleVerifiedDatabase<Options["operation"]>(
    context,
    {
      role: options.role,
      operation: options.operation,
      confirmation: options.confirmation,
      authorizeOperation: true,
    },
  );
  if (options.operation === "read") return database;
  try {
    await verifyEnvironmentConvergence(context);
    return database;
  } catch (error) {
    await database.end().catch(() => undefined);
    throw error;
  }
}

export function getDeclaredPublicEnvironment(): DeclaredPublicEnvironmentIdentity {
  let declaration: EnvironmentDeclaration;
  try {
    declaration = getEnvironmentDeclaration();
  } catch (error) {
    throw new EnvironmentContractError("ENV_CONFIGURATION_INVALID", error);
  }
  return {
    environment: declaration.environment,
    dataClass: declaration.dataClass,
    databaseName: null,
    runId: declaration.runId,
    safeFingerprint: null,
    verified: false,
  };
}

export function toPublicEnvironmentIdentity(
  identity: DatabaseIdentity,
): VerifiedPublicEnvironmentIdentity {
  return {
    environment: identity.environment,
    dataClass: identity.dataClass,
    databaseName: identity.databaseName,
    runId: identity.runId,
    safeFingerprint: identity.safeFingerprint,
    verified: true,
  };
}

export function assertDatabaseIdentitiesConverge(
  identities: readonly DatabaseIdentity[],
): void {
  if (
    identities.length !== DATABASE_ROLES.length ||
    new Set(identities.map((identity) => identity.databaseRole)).size !==
      DATABASE_ROLES.length
  ) {
    throw new EnvironmentContractError("ENV_TARGET_MISMATCH");
  }
  const expected = identities[0];
  for (const actual of identities.slice(1)) {
    assertSameDatabaseIdentity(expected, actual);
  }
}

export async function verifyDeclaredEnvironmentConvergence(): Promise<
  readonly DatabaseIdentity[]
> {
  try {
    for (const role of DATABASE_ROLES) assertProcessMayUseDatabaseRole(role);
  } catch (error) {
    throw new EnvironmentContractError("ENV_CONFIGURATION_INVALID", error);
  }
  const context = resolveRuntimeDatabaseContext();
  return verifyEnvironmentConvergence(context);
}

export async function verifyEnvironmentConvergenceWithCredentials(input: {
  declaration: EnvironmentDeclaration;
  expectedRoleNames: Readonly<Record<DatabaseRole, string>>;
  databaseUrls: Readonly<Record<DatabaseRole, string>>;
  expectedMarkerState?: "active" | "quarantined";
}): Promise<readonly DatabaseIdentity[]> {
  return verifyEnvironmentConvergence(
    {
      declaration: input.declaration,
      expectedRoleNames: input.expectedRoleNames,
    },
    input.databaseUrls,
    input.expectedMarkerState,
  );
}

async function verifyEnvironmentConvergence(
  context: RuntimeDatabaseContext,
  databaseUrls?: Readonly<Record<DatabaseRole, string>>,
  expectedMarkerState: "active" | "quarantined" = "active",
): Promise<readonly DatabaseIdentity[]> {
  const results = await Promise.allSettled(
    DATABASE_ROLES.map((role) =>
      openSingleVerifiedDatabase(context, {
        role,
        operation: "read",
        authorizeOperation: false,
        rawUrl: databaseUrls?.[role],
        expectedMarkerState,
      }),
    ),
  );
  const databases = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  try {
    if (failure) throw failure.reason;
    const identities = databases.map((database) => database.identity);
    assertDatabaseIdentitiesConverge(identities);
    return identities;
  } finally {
    await Promise.all(databases.map((database) => database.end()));
  }
}

function resolveRuntimeDatabaseContext(): RuntimeDatabaseContext {
  try {
    const declaration = getEnvironmentDeclaration();
    const expectedRoleNames = Object.fromEntries(
      DATABASE_ROLES.map((role) => [role, getExpectedDatabaseRoleName(role)]),
    ) as Record<DatabaseRole, string>;
    return { declaration, expectedRoleNames };
  } catch (error) {
    throw new EnvironmentContractError("ENV_CONFIGURATION_INVALID", error);
  }
}

async function openSingleVerifiedDatabase<Operation extends DatabaseOperation>(
  context: RuntimeDatabaseContext,
  options: InternalOpenVerifiedDatabaseOptions<Operation>,
): Promise<VerifiedDatabase<Operation>> {
  let rawUrl: string;
  try {
    rawUrl =
      options.rawUrl ??
      getEnvironmentDatabaseUrl(options.role, context.declaration.environment);
  } catch (error) {
    throw new EnvironmentContractError("ENV_CONFIGURATION_INVALID", error);
  }
  const endpoint = parseDatabaseEndpoint(
    rawUrl,
    context.declaration.environment,
  );
  const database = new PostgresVerifiedDatabase({
    declaration: context.declaration,
    role: options.role,
    operation: options.operation,
    confirmation: options.confirmation?.trim() || null,
    rawUrl,
    expectedRoleNames: context.expectedRoleNames,
    endpoint,
    authorizeOperation: options.authorizeOperation,
    expectedMarkerState: options.expectedMarkerState,
  });
  try {
    await database.initialize();
    return createVerifiedDatabaseFacade(database);
  } catch (error) {
    await database.end().catch(() => undefined);
    if (error instanceof EnvironmentContractError) throw error;
    throw new EnvironmentContractError("ENV_CONNECT_FAILED", error);
  }
}

class PostgresVerifiedDatabase<Operation extends DatabaseOperation> {
  readonly [verifiedDatabaseBrand] = true as const;
  readonly role: DatabaseRole;
  readonly operation: Operation;
  readonly #pool: pg.Pool;
  readonly #declaration: EnvironmentDeclaration;
  readonly #confirmation: string | null;
  readonly #expectedRoleNames: Readonly<Record<DatabaseRole, string>>;
  readonly #endpoint: ParsedDatabaseEndpoint;
  readonly #applicationName: string;
  readonly #authorizeOperation: boolean;
  readonly #expectedMarkerState: "active" | "quarantined";
  #identity: DatabaseIdentity | null = null;

  constructor(input: {
    declaration: EnvironmentDeclaration;
    role: DatabaseRole;
    operation: Operation;
    confirmation: string | null;
    rawUrl: string;
    expectedRoleNames: Readonly<Record<DatabaseRole, string>>;
    endpoint: ParsedDatabaseEndpoint;
    authorizeOperation: boolean;
    expectedMarkerState?: "active" | "quarantined";
  }) {
    this.#declaration = input.declaration;
    this.role = input.role;
    this.operation = input.operation;
    this.#confirmation = input.confirmation;
    this.#expectedRoleNames = input.expectedRoleNames;
    this.#endpoint = input.endpoint;
    this.#authorizeOperation = input.authorizeOperation;
    this.#expectedMarkerState = input.expectedMarkerState ?? "active";
    this.#applicationName = buildApplicationName(
      input.declaration,
      input.role,
      input.operation,
    );
    this.#pool = new Pool({
      connectionString: input.rawUrl,
      application_name: this.#applicationName,
      max: input.role === "web" ? 10 : input.role === "worker" ? 4 : 1,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  get identity(): DatabaseIdentity {
    if (!this.#identity) {
      throw new EnvironmentContractError("ENV_CONNECT_FAILED");
    }
    return this.#identity;
  }

  async initialize(): Promise<void> {
    await this.verifyIdentity();
  }

  async verifyIdentity(): Promise<DatabaseIdentity> {
    const session = await this.connect();
    session.release();
    return this.identity;
  }

  async connect(): Promise<VerifiedSession> {
    let client: PoolClient;
    try {
      client = await this.#pool.connect();
    } catch (error) {
      throw new EnvironmentContractError("ENV_CONNECT_FAILED", error);
    }
    try {
      await this.#establishSessionBaseline(client);
      const identity = await this.#attest(client);
      if (this.#identity) {
        assertSameDatabaseIdentity(this.#identity, identity);
      } else {
        this.#identity = Object.freeze(identity);
      }
      return createVerifiedSession(client);
    } catch (error) {
      client.release(error instanceof Error ? error : new Error("attestation"));
      throw error;
    }
  }

  async query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    if (this.operation === "read") {
      return this.#readOnlyQuery<Row>(text, values);
    }
    const session = await this.connect();
    try {
      return await session.query<Row>(text, values);
    } finally {
      session.release();
    }
  }

  async end(): Promise<void> {
    await this.#pool.end();
  }

  async #readOnlyQuery<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> {
    const session = await this.connect();
    let transactionStarted = false;
    try {
      await session.query("BEGIN TRANSACTION READ ONLY");
      transactionStarted = true;
      // Lock the transaction mode before executing caller-controlled SQL. A
      // later SET TRANSACTION READ WRITE must fail after this first query.
      await session.query("SELECT 1");
      const queryConfig: QueryConfig & { queryMode: "extended" } = {
        text,
        values: values ?? [],
        queryMode: "extended",
      };
      const result = await session.query<Row>(queryConfig);
      await session.query("COMMIT");
      transactionStarted = false;
      return result;
    } catch (error) {
      if (transactionStarted) {
        await session.query("ROLLBACK").catch(() => undefined);
      }
      throw error;
    } finally {
      session.release();
    }
  }

  async #establishSessionBaseline(client: PoolClient): Promise<void> {
    const expectedRole = this.#expectedRoleNames[this.role];
    const guard = await client.query<RoleGuardRow>(
      "SELECT current_user::pg_catalog.text AS current_user_name, " +
        "session_user::pg_catalog.text AS session_user_name",
    );
    if (
      guard.rowCount !== 1 ||
      guard.rows[0]?.current_user_name !== expectedRole ||
      guard.rows[0]?.session_user_name !== expectedRole
    ) {
      throw new EnvironmentContractError("ENV_ROLE_MISMATCH");
    }
    await client.query("ROLLBACK");
    await client.query("DISCARD ALL");
    await client.query(
      "SELECT " +
        "pg_catalog.set_config('application_name', $1, false), " +
        "pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', false), " +
        "pg_catalog.set_config('row_security', 'on', false), " +
        "pg_catalog.set_config('default_transaction_read_only', $2, false)",
      [this.#applicationName, this.role === "web" ? "on" : "off"],
    );
  }

  async #attest(client: PoolClient): Promise<DatabaseIdentity> {
    let transactionStarted = false;
    try {
      await client.query("BEGIN TRANSACTION READ ONLY");
      transactionStarted = true;
      const probeResult = await client.query<ProbeRow>(
        "SELECT pg_catalog.current_database()::pg_catalog.text AS database_name, " +
          "current_user::pg_catalog.text AS current_user_name, " +
          "session_user::pg_catalog.text AS session_user_name, " +
          "pg_catalog.inet_server_addr()::pg_catalog.text AS server_address, " +
          "pg_catalog.inet_server_port()::pg_catalog.int4 AS server_port, " +
          "pg_catalog.pg_is_in_recovery() AS in_recovery, " +
          "pg_catalog.current_setting('transaction_read_only') = 'on' AS transaction_read_only, " +
          "role.rolsuper AS role_superuser, " +
          "role.rolcreatedb AS role_create_database, " +
          "role.rolcreaterole AS role_create_role, " +
          "role.rolinherit AS role_inherit, " +
          "role.rolcanlogin AS role_login, " +
          "role.rolreplication AS role_replication, " +
          "role.rolbypassrls AS role_bypass_rls, " +
          "(SELECT pg_catalog.count(*)::pg_catalog.int4 FROM pg_catalog.pg_auth_members membership " +
          "WHERE membership.member = role.oid OR membership.roleid = role.oid) " +
          "AS role_membership_count, " +
          "ARRAY(SELECT candidate.rolname::pg_catalog.text || ':' || " +
          "candidate.rolsuper::pg_catalog.text || ':' || " +
          "candidate.rolcreatedb::pg_catalog.text || ':' || " +
          "candidate.rolcreaterole::pg_catalog.text || ':' || " +
          "candidate.rolinherit::pg_catalog.text || ':' || " +
          "candidate.rolcanlogin::pg_catalog.text || ':' || " +
          "candidate.rolreplication::pg_catalog.text || ':' || " +
          "candidate.rolbypassrls::pg_catalog.text || ':' || " +
          "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members membership " +
          "WHERE membership.member = candidate.oid OR membership.roleid = candidate.oid)::pg_catalog.text " +
          "FROM pg_catalog.pg_roles candidate WHERE candidate.rolname IN ($2, $3, $4) " +
          "ORDER BY 1) AS expected_role_matrix, " +
          "(COALESCE(pg_catalog.has_schema_privilege(current_user, " +
          "pg_catalog.to_regnamespace('medota2_control'), 'CREATE'), false) OR " +
          "COALESCE(pg_catalog.has_table_privilege(current_user, " +
          "pg_catalog.to_regclass('medota2_control.environment_identity'), " +
          "'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'), false) OR " +
          "COALESCE(pg_catalog.has_any_column_privilege(current_user, " +
          "pg_catalog.to_regclass('medota2_control.environment_identity'), " +
          "'INSERT,UPDATE,REFERENCES'), false)) " +
          "AS role_has_control_write, " +
          "(SELECT pg_catalog.pg_get_userbyid(database.datdba)::pg_catalog.text " +
          "FROM pg_catalog.pg_database database WHERE database.datname = " +
          "pg_catalog.current_database()) AS database_owner, " +
          "ARRAY(SELECT (CASE WHEN access.grantee = 0 THEN 'PUBLIC' ELSE " +
          "pg_catalog.pg_get_userbyid(access.grantee)::pg_catalog.text END) || ':' || " +
          "access.privilege_type || ':' || access.is_grantable::pg_catalog.text " +
          "FROM pg_catalog.pg_database database " +
          "CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(database.datacl, " +
          "pg_catalog.acldefault('d', database.datdba))) access " +
          "WHERE database.datname = pg_catalog.current_database() AND " +
          "access.privilege_type IN ('CREATE', 'CONNECT', 'TEMPORARY') " +
          "ORDER BY 1) AS database_access_privileges, " +
          "ARRAY(SELECT database.datname::pg_catalog.text || ':' || privilege.name " +
          "FROM pg_catalog.pg_database database CROSS JOIN " +
          "pg_catalog.unnest(ARRAY['CONNECT', 'TEMPORARY']::pg_catalog.text[]) " +
          "AS privilege(name) WHERE database.datallowconn AND " +
          "database.datname <> pg_catalog.current_database() AND " +
          "pg_catalog.has_database_privilege(current_user, database.oid, privilege.name) " +
          "ORDER BY 1) AS accessible_other_databases, " +
          "(SELECT pg_catalog.pg_get_userbyid(namespace.nspowner)::pg_catalog.text " +
          "FROM pg_catalog.pg_namespace namespace WHERE namespace.oid = " +
          "pg_catalog.to_regnamespace('medota2_control')) AS control_schema_owner, " +
          "(SELECT pg_catalog.pg_get_userbyid(object.relowner)::pg_catalog.text " +
          "FROM pg_catalog.pg_class object WHERE object.oid = " +
          "pg_catalog.to_regclass('medota2_control.environment_identity')) " +
          "AS control_relation_owner, " +
          "(SELECT object.relkind::pg_catalog.text FROM pg_catalog.pg_class object " +
          "WHERE object.oid = pg_catalog.to_regclass(" +
          "'medota2_control.environment_identity')) AS control_relation_kind, " +
          "ARRAY(SELECT attribute.attname::pg_catalog.text || ':' || " +
          "pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':' || " +
          "attribute.attnotnull::pg_catalog.text FROM pg_catalog.pg_attribute attribute " +
          "WHERE attribute.attrelid = pg_catalog.to_regclass(" +
          "'medota2_control.environment_identity') AND attribute.attnum > 0 " +
          "AND NOT attribute.attisdropped ORDER BY attribute.attnum) AS control_table_shape, " +
          "ARRAY(SELECT constraint_record.contype::pg_catalog.text || ':' || " +
          "pg_catalog.pg_get_constraintdef(constraint_record.oid, true) " +
          "FROM pg_catalog.pg_constraint constraint_record WHERE constraint_record.conrelid = " +
          "pg_catalog.to_regclass('medota2_control.environment_identity') " +
          "ORDER BY constraint_record.contype, constraint_record.conname) AS control_constraint_shape, " +
          "COALESCE((SELECT NOT control_role.rolcanlogin AND NOT control_role.rolsuper " +
          "AND NOT control_role.rolcreatedb AND NOT control_role.rolcreaterole " +
          "AND NOT control_role.rolinherit AND NOT control_role.rolreplication " +
          "AND NOT control_role.rolbypassrls AND " +
          "NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members membership " +
          "WHERE membership.roleid = control_role.oid OR membership.member = control_role.oid) " +
          "FROM pg_catalog.pg_roles control_role WHERE control_role.rolname = $1), false) " +
          "AS control_owner_is_isolated, " +
          "(pg_catalog.has_database_privilege(current_user, pg_catalog.current_database(), 'CREATE') OR " +
          "EXISTS (SELECT 1 FROM pg_catalog.pg_namespace namespace " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' " +
          "AND (namespace.nspowner = role.oid OR " +
          "pg_catalog.has_schema_privilege(current_user, namespace.oid, 'CREATE'))) OR " +
          "EXISTS (SELECT 1 FROM pg_catalog.pg_class object " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' " +
          "AND object.relowner = role.oid) OR " +
          "EXISTS (SELECT 1 FROM pg_catalog.pg_proc routine " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' " +
          "AND routine.proowner = role.oid) OR " +
          "EXISTS (SELECT 1 FROM pg_catalog.pg_type type " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = type.typnamespace " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' " +
          "AND type.typowner = role.oid)) " +
          "AS role_has_application_ddl, " +
          "(EXISTS (SELECT 1 FROM pg_catalog.pg_class object " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace " +
          "CROSS JOIN LATERAL pg_catalog.aclexplode(object.relacl) access " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' AND access.grantee = role.oid " +
          "AND access.is_grantable) OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute attribute " +
          "JOIN pg_catalog.pg_class object ON object.oid = attribute.attrelid " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace " +
          "CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) access " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' AND access.grantee = role.oid " +
          "AND access.is_grantable) OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc routine " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace " +
          "CROSS JOIN LATERAL pg_catalog.aclexplode(routine.proacl) access " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' AND access.grantee = role.oid " +
          "AND access.is_grantable)) AS role_has_application_grant_options, " +
          "ARRAY(SELECT owner.rolname::pg_catalog.text || '|' || " +
          "COALESCE(namespace.nspname::pg_catalog.text, '<global>') || '|' || " +
          "defaults.defaclobjtype::pg_catalog.text || '|' || " +
          "(CASE WHEN access.grantee = 0 THEN 'PUBLIC' ELSE " +
          "pg_catalog.pg_get_userbyid(access.grantee)::pg_catalog.text END) || ':' || " +
          "access.privilege_type || ':' || access.is_grantable::pg_catalog.text " +
          "FROM pg_catalog.pg_default_acl defaults JOIN pg_catalog.pg_roles owner " +
          "ON owner.oid = defaults.defaclrole LEFT JOIN pg_catalog.pg_namespace namespace " +
          "ON namespace.oid = defaults.defaclnamespace CROSS JOIN LATERAL " +
          "pg_catalog.aclexplode(defaults.defaclacl) access ORDER BY 1) " +
          "AS application_default_privileges, " +
          "ARRAY(SELECT extension.extname::pg_catalog.text || '|' || " +
          "extension.extversion::pg_catalog.text || '|' || " +
          "namespace.nspname::pg_catalog.text || '|' || " +
          "pg_catalog.pg_get_userbyid(extension.extowner)::pg_catalog.text " +
          "FROM pg_catalog.pg_extension extension JOIN pg_catalog.pg_namespace namespace " +
          "ON namespace.oid = extension.extnamespace WHERE extension.extname <> 'plpgsql' " +
          "ORDER BY extension.extname) AS application_extensions, " +
          "ARRAY(SELECT CASE WHEN member.classid = " +
          "'pg_catalog.pg_proc'::pg_catalog.regclass AND member.objsubid = 0 THEN " +
          "'pg_proc|' || member_namespace.nspname::pg_catalog.text || '.' || " +
          "member_routine.proname::pg_catalog.text || '(' || " +
          "pg_catalog.pg_get_function_identity_arguments(member_routine.oid) || ')' ELSE " +
          "member.classid::pg_catalog.regclass::pg_catalog.text || '|' || " +
          "pg_catalog.pg_describe_object(member.classid, member.objid, member.objsubid) END " +
          "FROM pg_catalog.pg_depend member JOIN pg_catalog.pg_extension extension " +
          "ON extension.oid = member.refobjid LEFT JOIN pg_catalog.pg_proc member_routine " +
          "ON member.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass " +
          "AND member_routine.oid = member.objid LEFT JOIN pg_catalog.pg_namespace member_namespace " +
          "ON member_namespace.oid = member_routine.pronamespace WHERE member.deptype = 'e' " +
          "AND extension.extname = 'pgcrypto' ORDER BY 1) AS application_extension_members, " +
          "((SELECT pg_catalog.count(*) FROM pg_catalog.pg_foreign_data_wrapper) + " +
          "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_foreign_server) + " +
          "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_foreign_table) + " +
          "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_publication) + " +
          "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_replication_slots slot " +
          "WHERE slot.database = pg_catalog.current_database()) + " +
          "(SELECT pg_catalog.count(*) FROM pg_catalog.pg_replication_origin))::pg_catalog.int4 " +
          "AS external_data_link_count, " +
          "(SELECT pg_catalog.count(*)::pg_catalog.int4 FROM pg_catalog.pg_prepared_xacts prepared " +
          "WHERE prepared.database = pg_catalog.current_database()) AS prepared_transaction_count, " +
          "ARRAY(SELECT finding FROM (" +
          "SELECT 'schema:' || namespace.nspname::pg_catalog.text || ':' || " +
          "pg_catalog.pg_get_userbyid(namespace.nspowner)::pg_catalog.text AS finding " +
          "FROM pg_catalog.pg_namespace namespace WHERE namespace.nspname NOT IN " +
          "('pg_catalog', 'information_schema', 'medota2_control') AND " +
          "namespace.nspname !~ '^pg_(toast|temp)(_|$)' AND " +
          "pg_catalog.pg_get_userbyid(namespace.nspowner)::pg_catalog.text " +
          "NOT IN ($2, 'pg_database_owner') UNION ALL " +
          "SELECT 'relation:' || namespace.nspname::pg_catalog.text || '.' || " +
          "object.relname::pg_catalog.text || ':' || " +
          "pg_catalog.pg_get_userbyid(object.relowner)::pg_catalog.text " +
          "FROM pg_catalog.pg_class object JOIN pg_catalog.pg_namespace namespace " +
          "ON namespace.oid = object.relnamespace WHERE namespace.nspname NOT IN " +
          "('pg_catalog', 'information_schema', 'medota2_control') AND " +
          "namespace.nspname !~ '^pg_(toast|temp)(_|$)' AND " +
          "pg_catalog.pg_get_userbyid(object.relowner)::pg_catalog.text <> $2 AND " +
          "NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency " +
          "JOIN pg_catalog.pg_extension extension ON extension.oid = dependency.refobjid " +
          "WHERE dependency.classid = 'pg_catalog.pg_class'::pg_catalog.regclass " +
          "AND dependency.objid = object.oid AND dependency.deptype = 'e' " +
          "AND extension.extname = 'pgcrypto') UNION ALL " +
          "SELECT 'routine:' || routine.oid::pg_catalog.regprocedure::pg_catalog.text || ':' || " +
          "pg_catalog.pg_get_userbyid(routine.proowner)::pg_catalog.text " +
          "FROM pg_catalog.pg_proc routine JOIN pg_catalog.pg_namespace namespace " +
          "ON namespace.oid = routine.pronamespace WHERE namespace.nspname NOT IN " +
          "('pg_catalog', 'information_schema', 'medota2_control') AND " +
          "namespace.nspname !~ '^pg_(toast|temp)(_|$)' AND " +
          "pg_catalog.pg_get_userbyid(routine.proowner)::pg_catalog.text <> $2 AND " +
          "NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency " +
          "JOIN pg_catalog.pg_extension extension ON extension.oid = dependency.refobjid " +
          "WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass " +
          "AND dependency.objid = routine.oid AND dependency.deptype = 'e' " +
          "AND extension.extname = 'pgcrypto') UNION ALL " +
          "SELECT 'type:' || namespace.nspname::pg_catalog.text || '.' || " +
          "type.typname::pg_catalog.text || ':' || " +
          "pg_catalog.pg_get_userbyid(type.typowner)::pg_catalog.text " +
          "FROM pg_catalog.pg_type type JOIN pg_catalog.pg_namespace namespace " +
          "ON namespace.oid = type.typnamespace WHERE namespace.nspname NOT IN " +
          "('pg_catalog', 'information_schema', 'medota2_control') AND " +
          "namespace.nspname !~ '^pg_(toast|temp)(_|$)' AND " +
          "pg_catalog.pg_get_userbyid(type.typowner)::pg_catalog.text <> $2 AND " +
          "NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency " +
          "JOIN pg_catalog.pg_extension extension ON extension.oid = dependency.refobjid " +
          "WHERE dependency.classid = 'pg_catalog.pg_type'::pg_catalog.regclass " +
          "AND dependency.objid = type.oid AND dependency.deptype = 'e' " +
          "AND extension.extname = 'pgcrypto')" +
          ") findings ORDER BY finding) AS unexpected_application_object_owners, " +
          "ARRAY(SELECT namespace.nspname::pg_catalog.text || '.' || " +
          "object.relname::pg_catalog.text || ':' || privilege.name " +
          "FROM pg_catalog.pg_class object " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace " +
          "CROSS JOIN pg_catalog.unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', " +
          "'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']::pg_catalog.text[]) " +
          "AS privilege(name) " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' " +
          "AND object.relkind IN ('r', 'p', 'v', 'm', 'f') " +
          "AND pg_catalog.has_table_privilege(current_user, object.oid, privilege.name) " +
          "ORDER BY 1) AS application_table_dml_privileges, " +
          "ARRAY(SELECT namespace.nspname::pg_catalog.text || '.' || " +
          "object.relname::pg_catalog.text || '.' || " +
          "attribute.attname::pg_catalog.text || ':' || privilege.name " +
          "FROM pg_catalog.pg_class object " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace " +
          "JOIN pg_catalog.pg_attribute attribute ON attribute.attrelid = object.oid " +
          "CROSS JOIN pg_catalog.unnest(ARRAY['INSERT', 'UPDATE', " +
          "'REFERENCES']::pg_catalog.text[]) AS privilege(name) " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' " +
          "AND object.relkind IN ('r', 'p', 'v', 'm', 'f') " +
          "AND attribute.attnum > 0 AND NOT attribute.attisdropped " +
          "AND pg_catalog.has_column_privilege(current_user, object.oid, " +
          "attribute.attnum, privilege.name) " +
          "AND NOT pg_catalog.has_table_privilege(current_user, object.oid, " +
          "privilege.name) ORDER BY 1) AS application_column_dml_privileges, " +
          "ARRAY(SELECT namespace.nspname::pg_catalog.text || '.' || " +
          "object.relname::pg_catalog.text || ':' || privilege.name " +
          "FROM pg_catalog.pg_class object " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = object.relnamespace " +
          "CROSS JOIN pg_catalog.unnest(ARRAY['USAGE', " +
          "'UPDATE']::pg_catalog.text[]) AS privilege(name) " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' " +
          "AND object.relkind = 'S' " +
          "AND pg_catalog.has_sequence_privilege(current_user, object.oid, " +
          "privilege.name) ORDER BY 1) AS application_sequence_write_privileges, " +
          "ARRAY(SELECT namespace.nspname::pg_catalog.text || '.' || " +
          "routine.proname::pg_catalog.text || '(' || " +
          "pg_catalog.oidvectortypes(routine.proargtypes) || ')|' || " +
          "pg_catalog.pg_get_userbyid(routine.proowner)::pg_catalog.text || '|' || " +
          "routine.prokind::pg_catalog.text || '|' || " +
          "COALESCE(routine.proconfig::pg_catalog.text, '{}') || '|' || " +
          "pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(" +
          "pg_catalog.pg_get_functiondef(routine.oid), 'UTF8')), 'hex') " +
          "FROM pg_catalog.pg_proc routine " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' " +
          "AND routine.prosecdef " +
          "AND pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE') " +
          "ORDER BY 1) AS application_security_definer_functions, " +
          "ARRAY(SELECT namespace.nspname::pg_catalog.text || '.' || " +
          "routine.proname::pg_catalog.text || '(' || " +
          "pg_catalog.oidvectortypes(routine.proargtypes) || ')|' || " +
          "pg_catalog.pg_get_userbyid(routine.proowner)::pg_catalog.text || '|' || " +
          "routine.prokind::pg_catalog.text || '|' || " +
          "COALESCE(routine.proconfig::pg_catalog.text, '{}') || '|' || " +
          "pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(" +
          "pg_catalog.pg_get_functiondef(routine.oid), 'UTF8')), 'hex') " +
          "FROM pg_catalog.pg_proc routine " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' " +
          "AND routine.prosecdef ORDER BY 1) AS application_security_definer_inventory, " +
          "ARRAY(SELECT namespace.nspname::pg_catalog.text || '.' || " +
          "routine.proname::pg_catalog.text || '(' || " +
          "pg_catalog.oidvectortypes(routine.proargtypes) || ')|' || " +
          "language.lanname::pg_catalog.text || '|' || routine.prokind::pg_catalog.text " +
          "FROM pg_catalog.pg_proc routine " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = routine.pronamespace " +
          "JOIN pg_catalog.pg_language language ON language.oid = routine.prolang " +
          "WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' AND NOT routine.prosecdef " +
          "AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend dependency " +
          "WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass " +
          "AND dependency.objid = routine.oid AND dependency.deptype = 'e') " +
          "ORDER BY 1) AS application_invoker_routines, " +
          "ARRAY(SELECT finding FROM (" +
          "SELECT 'trigger:' || namespace.nspname::pg_catalog.text || '.' || " +
          "relation.relname::pg_catalog.text || ':' || trigger.tgname::pg_catalog.text " +
          "AS finding FROM pg_catalog.pg_trigger trigger " +
          "JOIN pg_catalog.pg_class relation ON relation.oid = trigger.tgrelid " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace " +
          "WHERE NOT trigger.tgisinternal AND namespace.nspname NOT IN " +
          "('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' UNION ALL " +
          "SELECT 'rule:' || namespace.nspname::pg_catalog.text || '.' || " +
          "relation.relname::pg_catalog.text || ':' || rewrite.rulename::pg_catalog.text " +
          "AS finding FROM pg_catalog.pg_rewrite rewrite " +
          "JOIN pg_catalog.pg_class relation ON relation.oid = rewrite.ev_class " +
          "JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace " +
          "WHERE rewrite.rulename <> '_RETURN' AND namespace.nspname NOT IN " +
          "('pg_catalog', 'information_schema') " +
          "AND namespace.nspname !~ '^pg_(toast|temp)(_|$)' UNION ALL " +
          "SELECT 'routing:' || child_namespace.nspname::pg_catalog.text || '.' || " +
          "child.relname::pg_catalog.text || '->' || parent_namespace.nspname::pg_catalog.text || '.' || " +
          "parent.relname::pg_catalog.text AS finding FROM pg_catalog.pg_inherits inheritance " +
          "JOIN pg_catalog.pg_class child ON child.oid = inheritance.inhrelid " +
          "JOIN pg_catalog.pg_namespace child_namespace ON child_namespace.oid = child.relnamespace " +
          "JOIN pg_catalog.pg_class parent ON parent.oid = inheritance.inhparent " +
          "JOIN pg_catalog.pg_namespace parent_namespace ON parent_namespace.oid = parent.relnamespace " +
          "WHERE child_namespace.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "AND child_namespace.nspname !~ '^pg_(toast|temp)(_|$)') findings " +
          "ORDER BY finding) AS application_automation_objects, " +
          "ARRAY(SELECT finding FROM (" +
          "SELECT 'delete-cascade:' || parent.oid::pg_catalog.regclass::pg_catalog.text || " +
          "'->' || child.oid::pg_catalog.regclass::pg_catalog.text || ':' || " +
          "constraint_record.conname::pg_catalog.text AS finding " +
          "FROM pg_catalog.pg_constraint constraint_record " +
          "JOIN pg_catalog.pg_class child ON child.oid = constraint_record.conrelid " +
          "JOIN pg_catalog.pg_class parent ON parent.oid = constraint_record.confrelid " +
          "WHERE constraint_record.contype = 'f' AND constraint_record.confdeltype = 'c' " +
          "AND pg_catalog.has_table_privilege(current_user, parent.oid, 'DELETE') " +
          "AND NOT pg_catalog.has_table_privilege(current_user, child.oid, 'DELETE') " +
          "UNION ALL SELECT 'delete-update:' || parent.oid::pg_catalog.regclass::pg_catalog.text || " +
          "'->' || child.oid::pg_catalog.regclass::pg_catalog.text || ':' || " +
          "constraint_record.conname::pg_catalog.text FROM pg_catalog.pg_constraint constraint_record " +
          "JOIN pg_catalog.pg_class child ON child.oid = constraint_record.conrelid " +
          "JOIN pg_catalog.pg_class parent ON parent.oid = constraint_record.confrelid " +
          "WHERE constraint_record.contype = 'f' AND constraint_record.confdeltype IN ('n', 'd') " +
          "AND pg_catalog.has_table_privilege(current_user, parent.oid, 'DELETE') " +
          "AND NOT pg_catalog.has_table_privilege(current_user, child.oid, 'UPDATE') " +
          "UNION ALL SELECT 'update-cascade:' || parent.oid::pg_catalog.regclass::pg_catalog.text || " +
          "'->' || child.oid::pg_catalog.regclass::pg_catalog.text || ':' || " +
          "constraint_record.conname::pg_catalog.text FROM pg_catalog.pg_constraint constraint_record " +
          "JOIN pg_catalog.pg_class child ON child.oid = constraint_record.conrelid " +
          "JOIN pg_catalog.pg_class parent ON parent.oid = constraint_record.confrelid " +
          "WHERE constraint_record.contype = 'f' AND constraint_record.confupdtype IN ('c', 'n', 'd') " +
          "AND pg_catalog.has_table_privilege(current_user, parent.oid, 'UPDATE') " +
          "AND NOT pg_catalog.has_table_privilege(current_user, child.oid, 'UPDATE')" +
          ") paths ORDER BY finding) AS application_referential_write_paths, " +
          "ARRAY(SELECT parameter.parname::pg_catalog.text || ':' || privilege.name " +
          "FROM pg_catalog.pg_parameter_acl parameter " +
          "CROSS JOIN pg_catalog.unnest(ARRAY['SET', " +
          "'ALTER SYSTEM']::pg_catalog.text[]) AS privilege(name) " +
          "WHERE pg_catalog.has_parameter_privilege(current_user, " +
          "parameter.parname, privilege.name) ORDER BY 1) AS parameter_privileges, " +
          "ARRAY(SELECT routine.oid::pg_catalog.regprocedure::pg_catalog.text " +
          "FROM pg_catalog.pg_proc routine " +
          "WHERE (routine.oid IN (" +
          "'pg_catalog.lo_creat(pg_catalog.int4)'::pg_catalog.regprocedure, " +
          "'pg_catalog.lo_create(pg_catalog.oid)'::pg_catalog.regprocedure, " +
          "'pg_catalog.lo_export(pg_catalog.oid,pg_catalog.text)'::pg_catalog.regprocedure, " +
          "'pg_catalog.lo_from_bytea(pg_catalog.oid,pg_catalog.bytea)'::pg_catalog.regprocedure, " +
          "'pg_catalog.lo_import(pg_catalog.text)'::pg_catalog.regprocedure, " +
          "'pg_catalog.lo_import(pg_catalog.text,pg_catalog.oid)'::pg_catalog.regprocedure, " +
          "'pg_catalog.lo_open(pg_catalog.oid,pg_catalog.int4)'::pg_catalog.regprocedure, " +
          "'pg_catalog.lo_put(pg_catalog.oid,pg_catalog.int8,pg_catalog.bytea)'::pg_catalog.regprocedure, " +
          "'pg_catalog.lo_truncate(pg_catalog.int4,pg_catalog.int4)'::pg_catalog.regprocedure, " +
          "'pg_catalog.lo_truncate64(pg_catalog.int4,pg_catalog.int8)'::pg_catalog.regprocedure, " +
          "'pg_catalog.lo_unlink(pg_catalog.oid)'::pg_catalog.regprocedure, " +
          "'pg_catalog.lowrite(pg_catalog.int4,pg_catalog.bytea)'::pg_catalog.regprocedure) " +
          "OR routine.oid IN (" +
          "'pg_catalog.pg_logical_emit_message(pg_catalog.bool,pg_catalog.text,pg_catalog.bytea,pg_catalog.bool)'::pg_catalog.regprocedure, " +
          "'pg_catalog.pg_logical_emit_message(pg_catalog.bool,pg_catalog.text,pg_catalog.text,pg_catalog.bool)'::pg_catalog.regprocedure)) " +
          "AND pg_catalog.has_function_privilege(current_user, routine.oid, 'EXECUTE') " +
          "ORDER BY 1) AS dangerous_builtin_functions, " +
          "ARRAY(SELECT large_object.oid::pg_catalog.text || ':' || privilege.name " +
          "FROM pg_catalog.pg_largeobject_metadata large_object " +
          "CROSS JOIN pg_catalog.unnest(ARRAY['SELECT', 'UPDATE']::pg_catalog.text[]) " +
          "AS privilege(name) WHERE pg_catalog.has_largeobject_privilege(" +
          "current_user, large_object.oid, privilege.name) ORDER BY 1) " +
          "AS large_object_privileges, " +
          "EXISTS (SELECT 1 FROM pg_catalog.pg_largeobject_metadata large_object " +
          "WHERE large_object.lomowner = role.oid) AS role_owns_large_objects, " +
          "(SELECT system_identifier::pg_catalog.text FROM pg_catalog.pg_control_system()) " +
          "AS postgres_system_identifier, " +
          "pg_catalog.current_setting('search_path') AS search_path, " +
          "pg_catalog.current_setting('row_security') AS row_security, " +
          "pg_catalog.current_setting('session_replication_role') AS session_replication_role, " +
          "pg_catalog.current_setting('default_transaction_read_only') " +
          "AS default_transaction_read_only " +
          "FROM pg_catalog.pg_roles role WHERE role.rolname = current_user",
        [
          CONTROL_OWNER_ROLE_NAMES_BY_ENVIRONMENT[
            this.#declaration.environment
          ],
          this.#expectedRoleNames.migration,
          this.#expectedRoleNames.worker,
          this.#expectedRoleNames.web,
        ],
      );
      const markerResult = await client.query<MarkerRow>(
        "SELECT contract_version, instance_id::pg_catalog.text, " +
          "database_id::pg_catalog.text, environment, data_class, " +
          "database_name::pg_catalog.text, state, reset_policy, " +
          "migration_role::pg_catalog.text, worker_role::pg_catalog.text, " +
          "web_role::pg_catalog.text " +
          "FROM medota2_control.environment_identity WHERE singleton = true",
      );
      if (probeResult.rowCount !== 1) {
        throw new EnvironmentContractError("ENV_MARKER_INVALID");
      }
      if (markerResult.rowCount !== 1) {
        throw new EnvironmentContractError("ENV_MARKER_MISSING");
      }
      const probe = mapProbe(probeResult.rows[0], markerResult.rows[0]);
      const identity = attestEnvironment({
        declaration: this.#declaration,
        role: this.role,
        operation: this.operation,
        expectedRoleNames: this.#expectedRoleNames,
        expectedControlOwnerName:
          CONTROL_OWNER_ROLE_NAMES_BY_ENVIRONMENT[
            this.#declaration.environment
          ],
        endpoint: this.#endpoint,
        probe,
        confirmation: this.#confirmation,
        authorizeOperation: this.#authorizeOperation,
        expectedMarkerState: this.#expectedMarkerState,
      });
      await client.query("COMMIT");
      transactionStarted = false;
      return identity;
    } catch (error) {
      if (transactionStarted) {
        await client.query("ROLLBACK").catch(() => undefined);
      }
      if (isMissingMarkerError(error)) {
        throw new EnvironmentContractError("ENV_MARKER_MISSING", error);
      }
      throw error;
    }
  }
}

function createVerifiedDatabaseFacade<Operation extends DatabaseOperation>(
  database: PostgresVerifiedDatabase<Operation>,
): VerifiedDatabase<Operation> {
  const base = {
    [verifiedDatabaseBrand]: true as const,
    get identity(): DatabaseIdentity {
      return database.identity;
    },
    role: database.role,
    operation: database.operation,
    query: database.query.bind(database),
    verifyIdentity: database.verifyIdentity.bind(database),
    end: database.end.bind(database),
  };
  if (database.operation === "read") {
    return Object.freeze(base) as VerifiedDatabase<Operation>;
  }
  return Object.freeze({
    ...base,
    connect: database.connect.bind(database),
  }) as VerifiedDatabase<Operation>;
}

function createVerifiedSession(client: PoolClient): VerifiedSession {
  let released = false;
  const query = ((...args: unknown[]) => {
    if (released) {
      throw new EnvironmentContractError("ENV_CONNECT_FAILED");
    }
    return Reflect.apply(client.query, client, args);
  }) as PoolClient["query"];
  return Object.freeze({
    [verifiedSessionBrand]: true as const,
    query,
    release(error?: Error | boolean): void {
      if (released) return;
      released = true;
      client.release(error);
    },
  });
}

function mapProbe(probe: ProbeRow, marker: MarkerRow): DatabaseProbeSnapshot {
  const markerSnapshot: EnvironmentMarkerSnapshot = {
    contractVersion: marker.contract_version,
    instanceId: marker.instance_id,
    databaseId: marker.database_id,
    environment: marker.environment,
    dataClass: marker.data_class,
    databaseName: marker.database_name,
    state: marker.state,
    resetPolicy: marker.reset_policy,
    migrationRole: marker.migration_role,
    workerRole: marker.worker_role,
    webRole: marker.web_role,
  };
  return {
    databaseName: probe.database_name,
    currentUser: probe.current_user_name,
    sessionUser: probe.session_user_name,
    serverAddress: probe.server_address,
    serverPort: probe.server_port,
    inRecovery: probe.in_recovery,
    transactionReadOnly: probe.transaction_read_only,
    roleSuperuser: probe.role_superuser,
    roleCreateDatabase: probe.role_create_database,
    roleCreateRole: probe.role_create_role,
    roleInherit: probe.role_inherit,
    roleLogin: probe.role_login,
    roleReplication: probe.role_replication,
    roleBypassRls: probe.role_bypass_rls,
    roleMembershipCount: probe.role_membership_count,
    expectedRoleMatrix: probe.expected_role_matrix,
    roleHasControlWrite: probe.role_has_control_write,
    databaseOwner: probe.database_owner,
    databaseAccessPrivileges: probe.database_access_privileges,
    accessibleOtherDatabases: probe.accessible_other_databases,
    controlSchemaOwner: probe.control_schema_owner,
    controlRelationOwner: probe.control_relation_owner,
    controlRelationKind: probe.control_relation_kind,
    controlTableShape: probe.control_table_shape,
    controlConstraintShape: probe.control_constraint_shape,
    controlOwnerIsIsolated: probe.control_owner_is_isolated,
    roleHasApplicationDdl: probe.role_has_application_ddl,
    roleHasApplicationGrantOptions: probe.role_has_application_grant_options,
    applicationDefaultPrivileges: probe.application_default_privileges,
    applicationExtensions: probe.application_extensions,
    applicationExtensionMembers: probe.application_extension_members,
    externalDataLinkCount: probe.external_data_link_count,
    preparedTransactionCount: probe.prepared_transaction_count,
    unexpectedApplicationObjectOwners:
      probe.unexpected_application_object_owners,
    applicationTableDmlPrivileges: probe.application_table_dml_privileges,
    applicationColumnDmlPrivileges: probe.application_column_dml_privileges,
    applicationSequenceWritePrivileges:
      probe.application_sequence_write_privileges,
    applicationSecurityDefinerFunctions:
      probe.application_security_definer_functions,
    applicationSecurityDefinerInventory:
      probe.application_security_definer_inventory,
    applicationInvokerRoutines: probe.application_invoker_routines,
    applicationAutomationObjects: probe.application_automation_objects,
    applicationReferentialWritePaths: probe.application_referential_write_paths,
    parameterPrivileges: probe.parameter_privileges,
    dangerousBuiltinFunctions: probe.dangerous_builtin_functions,
    largeObjectPrivileges: probe.large_object_privileges,
    roleOwnsLargeObjects: probe.role_owns_large_objects,
    postgresSystemIdentifier: probe.postgres_system_identifier,
    searchPath: probe.search_path,
    rowSecurity: probe.row_security,
    sessionReplicationRole: probe.session_replication_role,
    defaultTransactionReadOnly: probe.default_transaction_read_only,
    marker: markerSnapshot,
  };
}

function assertSameDatabaseIdentity(
  expected: DatabaseIdentity,
  actual: DatabaseIdentity,
): void {
  if (
    expected.contractVersion !== actual.contractVersion ||
    expected.instanceId !== actual.instanceId ||
    expected.databaseId !== actual.databaseId ||
    expected.databaseName !== actual.databaseName ||
    expected.environment !== actual.environment ||
    expected.dataClass !== actual.dataClass ||
    expected.resetPolicy !== actual.resetPolicy ||
    expected.endpointHost !== actual.endpointHost ||
    expected.endpointPort !== actual.endpointPort ||
    expected.serverAddress !== actual.serverAddress ||
    expected.serverPort !== actual.serverPort ||
    expected.postgresSystemIdentifier !== actual.postgresSystemIdentifier
  ) {
    throw new EnvironmentContractError("ENV_TARGET_MISMATCH");
  }
}

function isMissingMarkerError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return error.code === "42P01" || error.code === "3F000";
}

function buildApplicationName(
  declaration: EnvironmentDeclaration,
  role: DatabaseRole,
  operation: DatabaseOperation,
): string {
  const run = declaration.runId ?? String(process.pid);
  return (
    "medota2-" +
    declaration.environment +
    "-" +
    role +
    "-" +
    operation +
    "-" +
    run
  ).slice(0, 63);
}

export { EnvironmentContractError } from "./policy";
