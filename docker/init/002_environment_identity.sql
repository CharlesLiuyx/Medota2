\set ON_ERROR_STOP on

-- One Docker volume is one Medota2 database instance. Every database in the
-- volume shares this instance UUID while retaining its own database UUID.
SELECT gen_random_uuid() AS medota2_instance_id \gset

\connect medota2
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA medota2_control AUTHORIZATION medota2_dev_control_owner;
REVOKE ALL ON SCHEMA medota2_control FROM PUBLIC;
GRANT USAGE ON SCHEMA medota2_control TO medota2_dev_migration, medota2_dev_worker, medota2_dev_web;

CREATE TABLE medota2_control.environment_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  contract_version smallint NOT NULL CHECK (contract_version = 1),
  instance_id uuid NOT NULL,
  database_id uuid NOT NULL UNIQUE,
  environment text NOT NULL CHECK (
    environment IN ('development', 'test', 'local-review', 'production')
  ),
  data_class text NOT NULL CHECK (
    data_class IN (
      'sandbox',
      'synthetic-fixture',
      'production-snapshot',
      'live-production'
    )
  ),
  database_name name NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'legacy', 'quarantined')),
  reset_policy text NOT NULL CHECK (
    reset_policy IN ('manual', 'run-scoped', 'explicit-rebuild', 'never')
  ),
  migration_role name NOT NULL,
  worker_role name NOT NULL,
  web_role name NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE medota2_control.environment_identity OWNER TO medota2_dev_control_owner;
REVOKE ALL ON medota2_control.environment_identity FROM PUBLIC;
GRANT SELECT ON medota2_control.environment_identity TO medota2_dev_migration, medota2_dev_worker, medota2_dev_web;
INSERT INTO medota2_control.environment_identity (
  singleton,
  contract_version,
  instance_id,
  database_id,
  environment,
  data_class,
  database_name,
  state,
  reset_policy,
  migration_role,
  worker_role,
  web_role
) VALUES (
  true,
  1,
  :'medota2_instance_id',
  gen_random_uuid(),
  'development',
  'sandbox',
  current_database(),
  'quarantined',
  'manual',
  'medota2_dev_migration',
  'medota2_dev_worker',
  'medota2_dev_web'
);

REVOKE EXECUTE ON FUNCTION pg_catalog.lo_creat(integer), pg_catalog.lo_create(oid),
  pg_catalog.lo_export(oid, text), pg_catalog.lo_from_bytea(oid, bytea),
  pg_catalog.lo_import(text), pg_catalog.lo_import(text, oid),
  pg_catalog.lo_open(oid, integer), pg_catalog.lo_put(oid, bigint, bytea),
  pg_catalog.lo_truncate(integer, integer), pg_catalog.lo_truncate64(integer, bigint),
  pg_catalog.lo_unlink(oid), pg_catalog.lowrite(integer, bytea),
  pg_catalog.pg_logical_emit_message(boolean, text, bytea, boolean),
  pg_catalog.pg_logical_emit_message(boolean, text, text, boolean) FROM PUBLIC;

\connect medota2_local
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA medota2_control AUTHORIZATION medota2_local_control_owner;
REVOKE ALL ON SCHEMA medota2_control FROM PUBLIC;
GRANT USAGE ON SCHEMA medota2_control TO medota2_local_migration, medota2_local_worker, medota2_local_web;

CREATE TABLE medota2_control.environment_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  contract_version smallint NOT NULL CHECK (contract_version = 1),
  instance_id uuid NOT NULL,
  database_id uuid NOT NULL UNIQUE,
  environment text NOT NULL CHECK (
    environment IN ('development', 'test', 'local-review', 'production')
  ),
  data_class text NOT NULL CHECK (
    data_class IN (
      'sandbox',
      'synthetic-fixture',
      'production-snapshot',
      'live-production'
    )
  ),
  database_name name NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'legacy', 'quarantined')),
  reset_policy text NOT NULL CHECK (
    reset_policy IN ('manual', 'run-scoped', 'explicit-rebuild', 'never')
  ),
  migration_role name NOT NULL,
  worker_role name NOT NULL,
  web_role name NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE medota2_control.environment_identity OWNER TO medota2_local_control_owner;
REVOKE ALL ON medota2_control.environment_identity FROM PUBLIC;
GRANT SELECT ON medota2_control.environment_identity TO medota2_local_migration, medota2_local_worker, medota2_local_web;
INSERT INTO medota2_control.environment_identity (
  singleton,
  contract_version,
  instance_id,
  database_id,
  environment,
  data_class,
  database_name,
  state,
  reset_policy,
  migration_role,
  worker_role,
  web_role
) VALUES (
  true,
  1,
  :'medota2_instance_id',
  gen_random_uuid(),
  'local-review',
  'production-snapshot',
  current_database(),
  'quarantined',
  'explicit-rebuild',
  'medota2_local_migration',
  'medota2_local_worker',
  'medota2_local_web'
);

REVOKE EXECUTE ON FUNCTION pg_catalog.lo_creat(integer), pg_catalog.lo_create(oid),
  pg_catalog.lo_export(oid, text), pg_catalog.lo_from_bytea(oid, bytea),
  pg_catalog.lo_import(text), pg_catalog.lo_import(text, oid),
  pg_catalog.lo_open(oid, integer), pg_catalog.lo_put(oid, bigint, bytea),
  pg_catalog.lo_truncate(integer, integer), pg_catalog.lo_truncate64(integer, bigint),
  pg_catalog.lo_unlink(oid), pg_catalog.lowrite(integer, bytea),
  pg_catalog.pg_logical_emit_message(boolean, text, bytea, boolean),
  pg_catalog.pg_logical_emit_message(boolean, text, text, boolean) FROM PUBLIC;

\connect medota2_test
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA medota2_control AUTHORIZATION medota2_test_control_owner;
REVOKE ALL ON SCHEMA medota2_control FROM PUBLIC;
GRANT USAGE ON SCHEMA medota2_control TO medota2_test_migration, medota2_test_worker, medota2_test_web;

CREATE TABLE medota2_control.environment_identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  contract_version smallint NOT NULL CHECK (contract_version = 1),
  instance_id uuid NOT NULL,
  database_id uuid NOT NULL UNIQUE,
  environment text NOT NULL CHECK (
    environment IN ('development', 'test', 'local-review', 'production')
  ),
  data_class text NOT NULL CHECK (
    data_class IN (
      'sandbox',
      'synthetic-fixture',
      'production-snapshot',
      'live-production'
    )
  ),
  database_name name NOT NULL,
  state text NOT NULL CHECK (state IN ('active', 'legacy', 'quarantined')),
  reset_policy text NOT NULL CHECK (
    reset_policy IN ('manual', 'run-scoped', 'explicit-rebuild', 'never')
  ),
  migration_role name NOT NULL,
  worker_role name NOT NULL,
  web_role name NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE medota2_control.environment_identity OWNER TO medota2_test_control_owner;
REVOKE ALL ON medota2_control.environment_identity FROM PUBLIC;
GRANT SELECT ON medota2_control.environment_identity TO medota2_test_migration, medota2_test_worker, medota2_test_web;
INSERT INTO medota2_control.environment_identity (
  singleton,
  contract_version,
  instance_id,
  database_id,
  environment,
  data_class,
  database_name,
  state,
  reset_policy,
  migration_role,
  worker_role,
  web_role
) VALUES (
  true,
  1,
  :'medota2_instance_id',
  gen_random_uuid(),
  'test',
  'synthetic-fixture',
  current_database(),
  'quarantined',
  'run-scoped',
  'medota2_test_migration',
  'medota2_test_worker',
  'medota2_test_web'
);

REVOKE EXECUTE ON FUNCTION pg_catalog.lo_creat(integer), pg_catalog.lo_create(oid),
  pg_catalog.lo_export(oid, text), pg_catalog.lo_from_bytea(oid, bytea),
  pg_catalog.lo_import(text), pg_catalog.lo_import(text, oid),
  pg_catalog.lo_open(oid, integer), pg_catalog.lo_put(oid, bigint, bytea),
  pg_catalog.lo_truncate(integer, integer), pg_catalog.lo_truncate64(integer, bigint),
  pg_catalog.lo_unlink(oid), pg_catalog.lowrite(integer, bytea),
  pg_catalog.pg_logical_emit_message(boolean, text, bytea, boolean),
  pg_catalog.pg_logical_emit_message(boolean, text, text, boolean) FROM PUBLIC;
