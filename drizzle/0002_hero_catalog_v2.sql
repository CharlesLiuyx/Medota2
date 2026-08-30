ALTER TABLE hero_dataset_versions RENAME TO hero_catalog_dataset_versions;

ALTER TABLE hero_catalog_dataset_versions
  ADD COLUMN selector_version text NOT NULL DEFAULT 'hero-metadata-static-v1',
  ADD COLUMN selector_manifest_sha256 text NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN semantic_sha256 text NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN gate_status text NOT NULL DEFAULT 'green',
  ADD COLUMN review_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN gate_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN source_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT hero_catalog_selector_manifest_sha256_check CHECK (selector_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT hero_catalog_semantic_sha256_check CHECK (semantic_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT hero_catalog_gate_status_check CHECK (gate_status IN ('green', 'yellow', 'red')),
  ADD CONSTRAINT hero_catalog_review_status_check CHECK (review_status IN ('not_required', 'pending', 'approved', 'rejected'));

ALTER TABLE hero_catalog_dataset_versions DROP CONSTRAINT hero_dataset_versions_status_check;
ALTER TABLE hero_catalog_dataset_versions
  ADD CONSTRAINT hero_catalog_dataset_status_check CHECK (status IN ('validated', 'candidate', 'promoted', 'rejected'));

DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT c.conname INTO constraint_name
  FROM pg_constraint c
  WHERE c.conrelid = 'hero_catalog_dataset_versions'::regclass
    AND c.contype = 'u'
    AND pg_get_constraintdef(c.oid) LIKE '%source_snapshot_id, importer_version, target_schema_version)%'
  LIMIT 1;
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE hero_catalog_dataset_versions DROP CONSTRAINT %I', constraint_name);
  END IF;
END
$$;

ALTER TABLE hero_catalog_dataset_versions
  ADD CONSTRAINT hero_catalog_dataset_idempotency_key
  UNIQUE (source_snapshot_id, importer_version, target_schema_version, selector_version);

ALTER TABLE dataset_heads RENAME COLUMN hero_dataset_version_id TO catalog_dataset_version_id;
ALTER TABLE dataset_heads DROP CONSTRAINT dataset_heads_dataset_key_check;
UPDATE dataset_heads SET dataset_key = 'hero_catalog' WHERE dataset_key = 'heroes';
ALTER TABLE dataset_heads
  ADD CONSTRAINT dataset_heads_dataset_key_check CHECK (dataset_key = 'hero_catalog');

ALTER TABLE import_runs RENAME COLUMN result_dataset_version_id TO result_catalog_version_id;

CREATE TABLE abilities (
  dataset_version_id uuid NOT NULL REFERENCES hero_catalog_dataset_versions(id) ON DELETE RESTRICT,
  internal_name text NOT NULL CHECK (internal_name ~ '^[a-z0-9_]+$'),
  declaration_kind text NOT NULL CHECK (declaration_kind IN ('top_level', 'implicit_talent')),
  definition_kind text NOT NULL CHECK (definition_kind IN ('ability', 'talent', 'template')),
  catalog_status text NOT NULL CHECK (catalog_status IN ('current', 'indirect', 'defined_unbound', 'template', 'deprecated')),
  ability_type text,
  behavior text[] NOT NULL DEFAULT '{}',
  unit_target_team text[] NOT NULL DEFAULT '{}',
  unit_target_type text[] NOT NULL DEFAULT '{}',
  unit_target_flags text[] NOT NULL DEFAULT '{}',
  damage_type text,
  spell_immunity_type text,
  spell_dispellable_type text,
  max_level integer,
  is_innate boolean NOT NULL,
  is_passive boolean NOT NULL,
  is_hidden boolean NOT NULL,
  is_ultimate boolean NOT NULL,
  has_scepter_upgrade boolean NOT NULL,
  has_shard_upgrade boolean NOT NULL,
  is_granted_by_scepter boolean NOT NULL,
  is_granted_by_shard boolean NOT NULL,
  cast_range text,
  cast_point text,
  channel_time text,
  cooldown text,
  mana_cost text,
  damage text,
  texture_name text NOT NULL,
  base_class text,
  raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[0-9a-f]{64}$'),
  resolved_sha256 text NOT NULL CHECK (resolved_sha256 ~ '^[0-9a-f]{64}$'),
  unknown_fields text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (dataset_version_id, internal_name)
);

CREATE TABLE ability_id_mappings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dataset_version_id uuid NOT NULL REFERENCES hero_catalog_dataset_versions(id) ON DELETE RESTRICT,
  internal_name text NOT NULL,
  ability_id integer NOT NULL,
  source_path text NOT NULL,
  source_line integer NOT NULL CHECK (source_line > 0),
  UNIQUE (dataset_version_id, internal_name, ability_id, source_path, source_line)
);

CREATE TABLE hero_ability_bindings (
  dataset_version_id uuid NOT NULL,
  hero_id integer NOT NULL,
  ability_internal_name text NOT NULL,
  source_slot text NOT NULL,
  relation_kind text NOT NULL CHECK (relation_kind IN ('loadout', 'talent', 'draft', 'facet', 'declared_in_hero_file', 'linked', 'sub_ability', 'upgrade_granted')),
  ordinal integer NOT NULL,
  is_current boolean NOT NULL,
  source_path text NOT NULL,
  source_line integer NOT NULL CHECK (source_line > 0),
  derivation_version text NOT NULL,
  PRIMARY KEY (dataset_version_id, hero_id, ability_internal_name, relation_kind, source_slot),
  FOREIGN KEY (dataset_version_id, hero_id) REFERENCES heroes(dataset_version_id, hero_id) ON DELETE RESTRICT,
  FOREIGN KEY (dataset_version_id, ability_internal_name) REFERENCES abilities(dataset_version_id, internal_name) ON DELETE RESTRICT
);

CREATE TABLE ability_values (
  dataset_version_id uuid NOT NULL,
  ability_internal_name text NOT NULL,
  value_key text NOT NULL,
  ordinal integer NOT NULL,
  scalar_value text,
  level_values text[] NOT NULL DEFAULT '{}',
  modifiers jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(modifiers) = 'array'),
  raw_value jsonb NOT NULL,
  PRIMARY KEY (dataset_version_id, ability_internal_name, ordinal),
  FOREIGN KEY (dataset_version_id, ability_internal_name) REFERENCES abilities(dataset_version_id, internal_name) ON DELETE RESTRICT
);

CREATE TABLE ability_localizations (
  dataset_version_id uuid NOT NULL,
  ability_internal_name text NOT NULL,
  locale text NOT NULL CHECK (locale ~ '^[a-z]{2,3}(?:-[A-Za-z0-9]+)*$'),
  display_name text,
  description text,
  lore text,
  scepter_description text,
  shard_description text,
  source_path text NOT NULL,
  name_token text NOT NULL,
  description_token text NOT NULL,
  lore_token text NOT NULL,
  scepter_token text NOT NULL,
  shard_token text NOT NULL,
  PRIMARY KEY (dataset_version_id, ability_internal_name, locale),
  FOREIGN KEY (dataset_version_id, ability_internal_name) REFERENCES abilities(dataset_version_id, internal_name) ON DELETE RESTRICT
);

CREATE TABLE facets (
  dataset_version_id uuid NOT NULL,
  hero_id integer NOT NULL,
  facet_key text NOT NULL,
  icon text,
  color text,
  gradient_id integer,
  deprecated boolean NOT NULL,
  source_path text NOT NULL,
  source_line integer NOT NULL CHECK (source_line > 0),
  raw_definition jsonb NOT NULL,
  PRIMARY KEY (dataset_version_id, hero_id, facet_key),
  FOREIGN KEY (dataset_version_id, hero_id) REFERENCES heroes(dataset_version_id, hero_id) ON DELETE RESTRICT
);

CREATE TABLE facet_ability_bindings (
  dataset_version_id uuid NOT NULL,
  hero_id integer NOT NULL,
  facet_key text NOT NULL,
  ability_internal_name text NOT NULL,
  source_path text NOT NULL,
  source_line integer NOT NULL CHECK (source_line > 0),
  PRIMARY KEY (dataset_version_id, hero_id, facet_key, ability_internal_name),
  FOREIGN KEY (dataset_version_id, hero_id, facet_key) REFERENCES facets(dataset_version_id, hero_id, facet_key) ON DELETE RESTRICT,
  FOREIGN KEY (dataset_version_id, ability_internal_name) REFERENCES abilities(dataset_version_id, internal_name) ON DELETE RESTRICT
);

CREATE TABLE entity_source_records (
  dataset_version_id uuid NOT NULL REFERENCES hero_catalog_dataset_versions(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN ('hero', 'ability', 'facet')),
  entity_key text NOT NULL,
  occurrence_ordinal integer NOT NULL DEFAULT 0,
  source_path text NOT NULL,
  source_line integer,
  source_key text NOT NULL,
  declaration_kind text,
  raw_definition jsonb NOT NULL,
  resolved_definition jsonb,
  raw_sha256 text NOT NULL CHECK (raw_sha256 ~ '^[0-9a-f]{64}$'),
  resolved_sha256 text CHECK (resolved_sha256 IS NULL OR resolved_sha256 ~ '^[0-9a-f]{64}$'),
  inherited_fields text[] NOT NULL DEFAULT '{}',
  unknown_fields text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (dataset_version_id, entity_type, entity_key, occurrence_ordinal)
);

CREATE TABLE asset_refs (
  dataset_version_id uuid NOT NULL REFERENCES hero_catalog_dataset_versions(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN ('hero', 'ability')),
  entity_key text NOT NULL,
  asset_kind text NOT NULL CHECK (asset_kind IN ('portrait', 'icon')),
  logical_path text NOT NULL,
  client_version text,
  content_sha256 text CHECK (content_sha256 IS NULL OR content_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text,
  width integer,
  height integer,
  cache_status text NOT NULL CHECK (cache_status IN ('available', 'missing', 'mismatch', 'error')),
  provider_version text NOT NULL,
  PRIMARY KEY (dataset_version_id, entity_type, entity_key, asset_kind)
);

CREATE TABLE catalog_import_staging (
  import_run_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('hero', 'ability', 'id_mapping', 'binding', 'facet')),
  entity_key text NOT NULL,
  ordinal integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL,
  PRIMARY KEY (import_run_id, entity_type, entity_key, ordinal)
);

CREATE TABLE catalog_semantic_diffs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_version_id uuid NOT NULL REFERENCES hero_catalog_dataset_versions(id) ON DELETE CASCADE,
  severity text NOT NULL CHECK (severity IN ('green', 'yellow', 'red')),
  diff_kind text NOT NULL,
  entity_type text NOT NULL,
  entity_key text NOT NULL,
  field_name text,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog_reviews (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  candidate_version_id uuid NOT NULL REFERENCES hero_catalog_dataset_versions(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reviewer text NOT NULL,
  reason text NOT NULL CHECK (reason <> ''),
  reviewed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE catalog_rollbacks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  from_version_id uuid NOT NULL REFERENCES hero_catalog_dataset_versions(id) ON DELETE RESTRICT,
  to_version_id uuid NOT NULL REFERENCES hero_catalog_dataset_versions(id) ON DELETE RESTRICT,
  actor text NOT NULL,
  reason text NOT NULL CHECK (reason <> ''),
  rolled_back_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX abilities_catalog_filter_idx ON abilities (dataset_version_id, catalog_status, definition_kind, internal_name);
CREATE INDEX ability_id_mappings_lookup_idx ON ability_id_mappings (dataset_version_id, internal_name, ability_id);
CREATE INDEX hero_ability_bindings_hero_idx ON hero_ability_bindings (dataset_version_id, hero_id, is_current, ordinal);
CREATE INDEX hero_ability_bindings_ability_idx ON hero_ability_bindings (dataset_version_id, ability_internal_name, relation_kind);
CREATE INDEX ability_localizations_name_idx ON ability_localizations (dataset_version_id, locale, display_name);
CREATE INDEX catalog_semantic_diffs_candidate_idx ON catalog_semantic_diffs (candidate_version_id, severity, entity_type);

DROP FUNCTION promote_hero_dataset_version(uuid);

CREATE OR REPLACE FUNCTION promote_hero_catalog_version(target_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_gate text;
  target_review text;
  target_status text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks
    WHERE locktype = 'advisory'
      AND pid = pg_catalog.pg_backend_pid()
      AND classid = 1296389185::oid
      AND objid = 1751740001::oid
      AND objsubid = 2
      AND granted
  ) THEN
    RAISE EXCEPTION 'hero_catalog import advisory lock is required';
  END IF;

  SELECT gate_status, review_status, status
  INTO target_gate, target_review, target_status
  FROM public.hero_catalog_dataset_versions
  WHERE id = target_version_id;

  IF target_status IS NULL THEN
    RAISE EXCEPTION 'catalog version % does not exist', target_version_id;
  END IF;
  IF target_status NOT IN ('validated', 'candidate', 'promoted') THEN
    RAISE EXCEPTION 'catalog version % is not promotable', target_version_id;
  END IF;
  IF target_gate = 'red' OR (target_gate = 'yellow' AND target_review <> 'approved') THEN
    RAISE EXCEPTION 'catalog version % has not passed its release gate', target_version_id;
  END IF;

  UPDATE public.hero_catalog_dataset_versions
  SET promoted_at = COALESCE(promoted_at, pg_catalog.now()), status = 'promoted'
  WHERE id = target_version_id;

  INSERT INTO public.dataset_heads (dataset_key, catalog_dataset_version_id, updated_at)
  VALUES ('hero_catalog', target_version_id, pg_catalog.now())
  ON CONFLICT (dataset_key) DO UPDATE
  SET catalog_dataset_version_id = EXCLUDED.catalog_dataset_version_id,
      updated_at = EXCLUDED.updated_at;
END;
$$;

CREATE OR REPLACE FUNCTION review_hero_catalog_version(target_version_id uuid, review_decision text, review_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF review_decision NOT IN ('approved', 'rejected') OR review_reason IS NULL OR review_reason = '' THEN
    RAISE EXCEPTION 'a valid review decision and non-empty reason are required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.hero_catalog_dataset_versions
    WHERE id = target_version_id AND gate_status = 'yellow' AND review_status = 'pending'
  ) THEN
    RAISE EXCEPTION 'catalog version % is not pending Yellow review', target_version_id;
  END IF;

  INSERT INTO public.catalog_reviews (candidate_version_id, decision, reviewer, reason)
  VALUES (target_version_id, review_decision, pg_catalog.session_user, review_reason);
  UPDATE public.hero_catalog_dataset_versions
  SET review_status = review_decision,
      status = CASE WHEN review_decision = 'rejected' THEN 'rejected' ELSE status END
  WHERE id = target_version_id;
END;
$$;

CREATE OR REPLACE FUNCTION rollback_hero_catalog_version(target_version_id uuid, rollback_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_version_id uuid;
  target_status text;
BEGIN
  IF rollback_reason IS NULL OR rollback_reason = '' THEN
    RAISE EXCEPTION 'a non-empty rollback reason is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks
    WHERE locktype = 'advisory'
      AND pid = pg_catalog.pg_backend_pid()
      AND classid = 1296389185::oid
      AND objid = 1751740001::oid
      AND objsubid = 2
      AND granted
  ) THEN
    RAISE EXCEPTION 'hero_catalog import advisory lock is required';
  END IF;

  SELECT status INTO target_status FROM public.hero_catalog_dataset_versions WHERE id = target_version_id;
  IF target_status NOT IN ('validated', 'promoted') THEN
    RAISE EXCEPTION 'catalog version % is not a validated rollback target', target_version_id;
  END IF;
  SELECT catalog_dataset_version_id INTO current_version_id
  FROM public.dataset_heads WHERE dataset_key = 'hero_catalog';
  IF current_version_id IS NULL THEN
    RAISE EXCEPTION 'there is no current hero_catalog version';
  END IF;

  INSERT INTO public.catalog_rollbacks (from_version_id, to_version_id, actor, reason)
  VALUES (current_version_id, target_version_id, pg_catalog.session_user, rollback_reason);
  UPDATE public.dataset_heads
  SET catalog_dataset_version_id = target_version_id, updated_at = pg_catalog.now()
  WHERE dataset_key = 'hero_catalog';
END;
$$;

REVOKE ALL ON FUNCTION promote_hero_catalog_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION review_hero_catalog_version(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION rollback_hero_catalog_version(uuid, text) FROM PUBLIC;

GRANT SELECT, INSERT ON hero_catalog_dataset_versions, abilities, ability_id_mappings,
  hero_ability_bindings, ability_values, ability_localizations, facets, facet_ability_bindings,
  entity_source_records, asset_refs, catalog_semantic_diffs TO medota2_worker;
GRANT SELECT, INSERT, DELETE ON catalog_import_staging TO medota2_worker;
GRANT SELECT ON catalog_reviews, catalog_rollbacks TO medota2_worker;
GRANT EXECUTE ON FUNCTION promote_hero_catalog_version(uuid) TO medota2_worker;
GRANT EXECUTE ON FUNCTION review_hero_catalog_version(uuid, text, text) TO medota2_worker;
GRANT EXECUTE ON FUNCTION rollback_hero_catalog_version(uuid, text) TO medota2_worker;

GRANT SELECT ON hero_catalog_dataset_versions, abilities, ability_id_mappings,
  hero_ability_bindings, ability_values, ability_localizations, facets, facet_ability_bindings,
  entity_source_records, asset_refs, catalog_semantic_diffs, catalog_reviews, catalog_rollbacks TO medota2_web;
