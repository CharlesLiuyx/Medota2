DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medota2_worker') THEN
    CREATE ROLE medota2_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'medota2_web') THEN
    CREATE ROLE medota2_web NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

CREATE TABLE source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_repository text NOT NULL,
  source_remote_url text NOT NULL,
  source_commit text NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40}$'),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  source_dirty boolean NOT NULL,
  source_inputs_match_head boolean NOT NULL CHECK (source_inputs_match_head),
  client_version text NOT NULL,
  source_revision text NOT NULL,
  version_date text,
  version_time text,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_repository, source_commit, manifest_sha256)
);

CREATE TABLE source_snapshot_files (
  source_snapshot_id uuid NOT NULL REFERENCES source_snapshots(id) ON DELETE RESTRICT,
  source_path text NOT NULL CHECK (source_path <> '' AND position(E'\t' in source_path) = 0 AND position(E'\n' in source_path) = 0),
  raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  encoding text NOT NULL CHECK (encoding IN ('ascii', 'utf-8', 'utf-8-bom')),
  PRIMARY KEY (source_snapshot_id, source_path)
);

CREATE TABLE import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL CHECK (source_kind IN ('vpk', 'dotaconstants', 'comparison')),
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  stage text NOT NULL,
  source_snapshot_id uuid REFERENCES source_snapshots(id) ON DELETE RESTRICT,
  medota2_commit text NOT NULL CHECK (medota2_commit ~ '^[0-9a-f]{40}$'),
  transformer_version text NOT NULL,
  target_schema_version text NOT NULL,
  source_dirty boolean,
  source_inputs_match_head boolean,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues) = 'array'),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_summary text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE hero_dataset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_snapshot_id uuid NOT NULL REFERENCES source_snapshots(id) ON DELETE RESTRICT,
  import_run_id uuid NOT NULL UNIQUE REFERENCES import_runs(id) ON DELETE RESTRICT,
  importer_version text NOT NULL,
  target_schema_version text NOT NULL,
  status text NOT NULL CHECK (status = 'validated'),
  created_at timestamptz NOT NULL DEFAULT now(),
  promoted_at timestamptz,
  UNIQUE (source_snapshot_id, importer_version, target_schema_version)
);

CREATE TABLE heroes (
  dataset_version_id uuid NOT NULL REFERENCES hero_dataset_versions(id) ON DELETE RESTRICT,
  hero_id integer NOT NULL CHECK (hero_id > 0),
  internal_name text NOT NULL CHECK (internal_name ~ '^npc_dota_hero_[a-z0-9_]+$'),
  slug text NOT NULL CHECK (slug ~ '^[a-z0-9_]+$'),
  enabled boolean NOT NULL,
  cm_enabled boolean NOT NULL,
  random_enabled boolean,
  primary_attribute text NOT NULL CHECK (primary_attribute IN ('strength', 'agility', 'intelligence', 'universal')),
  attack_type text NOT NULL CHECK (attack_type IN ('melee', 'ranged')),
  faction text NOT NULL CHECK (faction IN ('radiant', 'dire')),
  complexity smallint NOT NULL CHECK (complexity BETWEEN 1 AND 3),
  base_strength numeric(12,6) NOT NULL,
  strength_gain numeric(12,6) NOT NULL,
  base_agility numeric(12,6) NOT NULL,
  agility_gain numeric(12,6) NOT NULL,
  base_intelligence numeric(12,6) NOT NULL,
  intelligence_gain numeric(12,6) NOT NULL,
  base_health numeric(12,6) NOT NULL,
  base_mana numeric(12,6) NOT NULL,
  base_health_regen numeric(12,6) NOT NULL,
  base_mana_regen numeric(12,6) NOT NULL,
  base_armor numeric(12,6) NOT NULL,
  magic_resistance numeric(12,6) NOT NULL,
  base_attack_damage_min numeric(12,6) NOT NULL,
  base_attack_damage_max numeric(12,6) NOT NULL,
  base_attack_speed numeric(12,6) NOT NULL,
  attack_rate numeric(12,6) NOT NULL,
  attack_animation_point numeric(12,6) NOT NULL,
  attack_range numeric(12,6) NOT NULL,
  projectile_speed numeric(12,6) NOT NULL,
  movement_speed numeric(12,6) NOT NULL,
  turn_rate numeric(12,6) NOT NULL,
  day_vision numeric(12,6) NOT NULL,
  night_vision numeric(12,6) NOT NULL,
  PRIMARY KEY (dataset_version_id, hero_id),
  UNIQUE (dataset_version_id, internal_name),
  UNIQUE (dataset_version_id, slug),
  CHECK (base_attack_damage_max >= base_attack_damage_min)
);

CREATE TABLE hero_source_records (
  dataset_version_id uuid NOT NULL,
  hero_id integer NOT NULL,
  source_key text NOT NULL,
  source_dto_sha256 text NOT NULL CHECK (source_dto_sha256 ~ '^[0-9a-f]{64}$'),
  inherited_fields text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (dataset_version_id, hero_id),
  FOREIGN KEY (dataset_version_id, hero_id) REFERENCES heroes(dataset_version_id, hero_id) ON DELETE RESTRICT
);

CREATE TABLE hero_roles (
  dataset_version_id uuid NOT NULL,
  hero_id integer NOT NULL,
  role text NOT NULL CHECK (role IN ('carry', 'support', 'nuker', 'disabler', 'durable', 'escape', 'pusher', 'initiator')),
  role_level smallint NOT NULL CHECK (role_level BETWEEN 1 AND 3),
  PRIMARY KEY (dataset_version_id, hero_id, role),
  FOREIGN KEY (dataset_version_id, hero_id) REFERENCES heroes(dataset_version_id, hero_id) ON DELETE RESTRICT
);

CREATE TABLE hero_localizations (
  dataset_version_id uuid NOT NULL,
  hero_id integer NOT NULL,
  locale text NOT NULL CHECK (locale IN ('en', 'zh-CN')),
  display_name text NOT NULL CHECK (display_name <> ''),
  english_name_variant text,
  hype text,
  lore text,
  name_source_path text NOT NULL,
  name_token text NOT NULL,
  english_name_variant_token text,
  hype_source_path text,
  hype_token text,
  lore_source_path text,
  lore_token text,
  PRIMARY KEY (dataset_version_id, hero_id, locale),
  FOREIGN KEY (dataset_version_id, hero_id) REFERENCES heroes(dataset_version_id, hero_id) ON DELETE RESTRICT
);

CREATE TABLE dataset_heads (
  dataset_key text PRIMARY KEY CHECK (dataset_key = 'heroes'),
  hero_dataset_version_id uuid NOT NULL REFERENCES hero_dataset_versions(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hero_import_staging (
  import_run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  hero_id integer NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (import_run_id, hero_id)
);

CREATE TABLE reference_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_repository text NOT NULL,
  source_remote_url text NOT NULL,
  source_commit text NOT NULL CHECK (source_commit ~ '^[0-9a-f]{40}$'),
  source_dirty boolean NOT NULL,
  source_inputs_match_head boolean NOT NULL CHECK (source_inputs_match_head),
  package_version text NOT NULL,
  heroes_sha256 text NOT NULL CHECK (heroes_sha256 ~ '^[0-9a-f]{64}$'),
  package_sha256 text NOT NULL CHECK (package_sha256 ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_repository, source_commit, heroes_sha256, package_sha256)
);

CREATE TABLE reference_hero_records (
  reference_snapshot_id uuid NOT NULL REFERENCES reference_snapshots(id) ON DELETE RESTRICT,
  hero_id integer NOT NULL CHECK (hero_id > 0),
  internal_name text NOT NULL,
  raw_record jsonb NOT NULL,
  PRIMARY KEY (reference_snapshot_id, hero_id)
);

CREATE TABLE hero_reference_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_version_id uuid NOT NULL REFERENCES hero_dataset_versions(id) ON DELETE RESTRICT,
  reference_snapshot_id uuid NOT NULL REFERENCES reference_snapshots(id) ON DELETE RESTRICT,
  import_run_id uuid NOT NULL UNIQUE REFERENCES import_runs(id) ON DELETE RESTRICT,
  comparator_version text NOT NULL,
  canonical_count integer NOT NULL CHECK (canonical_count >= 0),
  reference_count integer NOT NULL CHECK (reference_count >= 0),
  matched_count integer NOT NULL CHECK (matched_count >= 0),
  diff_count integer NOT NULL CHECK (diff_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dataset_version_id, reference_snapshot_id, comparator_version)
);

CREATE TABLE hero_reference_diffs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  comparison_id uuid NOT NULL REFERENCES hero_reference_comparisons(id) ON DELETE CASCADE,
  hero_id integer NOT NULL CHECK (hero_id > 0),
  field_name text NOT NULL,
  diff_type text NOT NULL CHECK (diff_type IN ('missing_in_reference', 'extra_in_reference', 'identity_mismatch', 'value_mismatch')),
  canonical_value jsonb,
  reference_value jsonb
);

ALTER TABLE import_runs
  ADD COLUMN result_dataset_version_id uuid REFERENCES hero_dataset_versions(id) ON DELETE RESTRICT,
  ADD COLUMN result_reference_snapshot_id uuid REFERENCES reference_snapshots(id) ON DELETE RESTRICT,
  ADD COLUMN result_comparison_id uuid REFERENCES hero_reference_comparisons(id) ON DELETE RESTRICT;

CREATE INDEX heroes_filter_idx ON heroes (dataset_version_id, primary_attribute, attack_type, cm_enabled, hero_id);
CREATE INDEX hero_roles_filter_idx ON hero_roles (dataset_version_id, role, hero_id);
CREATE INDEX import_runs_status_idx ON import_runs (source_kind, status, finished_at DESC);
CREATE INDEX hero_reference_diffs_hero_idx ON hero_reference_diffs (comparison_id, hero_id);

CREATE OR REPLACE FUNCTION promote_hero_dataset_version(target_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_locks
    WHERE locktype = 'advisory'
      AND pid = pg_catalog.pg_backend_pid()
      AND classid = 1296389185::oid
      AND objid = 1751740001::oid
      AND objsubid = 2
      AND granted
  ) THEN
    RAISE EXCEPTION 'heroes import advisory lock is required';
  END IF;

  SELECT status INTO target_status
  FROM public.hero_dataset_versions
  WHERE id = target_version_id;

  IF target_status IS DISTINCT FROM 'validated' THEN
    RAISE EXCEPTION 'dataset version % is not validated', target_version_id;
  END IF;

  UPDATE public.hero_dataset_versions
  SET promoted_at = pg_catalog.now()
  WHERE id = target_version_id;

  INSERT INTO public.dataset_heads (dataset_key, hero_dataset_version_id, updated_at)
  VALUES ('heroes', target_version_id, pg_catalog.now())
  ON CONFLICT (dataset_key) DO UPDATE
  SET hero_dataset_version_id = EXCLUDED.hero_dataset_version_id,
      updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON FUNCTION promote_hero_dataset_version(uuid) FROM PUBLIC;

GRANT USAGE ON SCHEMA public TO medota2_worker, medota2_web;
GRANT SELECT ON schema_migrations TO medota2_worker, medota2_web;

GRANT SELECT, INSERT, UPDATE ON import_runs TO medota2_worker;
GRANT SELECT, INSERT ON source_snapshots, source_snapshot_files, hero_dataset_versions, heroes, hero_source_records, hero_roles, hero_localizations TO medota2_worker;
GRANT SELECT, INSERT, DELETE ON hero_import_staging TO medota2_worker;
GRANT SELECT ON dataset_heads TO medota2_worker;
GRANT SELECT, INSERT ON reference_snapshots, reference_hero_records, hero_reference_comparisons, hero_reference_diffs TO medota2_worker;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO medota2_worker;
GRANT EXECUTE ON FUNCTION promote_hero_dataset_version(uuid) TO medota2_worker;

GRANT SELECT ON source_snapshots, source_snapshot_files, import_runs, hero_dataset_versions, heroes, hero_source_records, hero_roles, hero_localizations, dataset_heads, reference_snapshots, reference_hero_records, hero_reference_comparisons, hero_reference_diffs TO medota2_web;
