CREATE TABLE asset_blobs (
  content_sha256 text PRIMARY KEY CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  mime_type text NOT NULL CHECK (mime_type <> ''),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_blobs_byte_size_matches_content
    CHECK (byte_size = octet_length(content))
);

CREATE TABLE asset_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_sha256 text NOT NULL UNIQUE CHECK (object_sha256 ~ '^[0-9a-f]{64}$'),
  asset_kind text NOT NULL CHECK (asset_kind = 'icon'),
  logical_path text NOT NULL CHECK (logical_path <> ''),
  source_type text NOT NULL CHECK (source_type IN ('exact', 'alias', 'generated_fallback')),
  source_repository text,
  source_commit text CHECK (source_commit IS NULL OR source_commit ~ '^[0-9a-f]{40}$'),
  client_version text,
  source_content_sha256 text CHECK (
    source_content_sha256 IS NULL OR source_content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  original_blob_sha256 text NOT NULL REFERENCES asset_blobs(content_sha256) ON DELETE RESTRICT,
  provider_version text NOT NULL CHECK (provider_version <> ''),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE asset_variants (
  asset_object_id uuid NOT NULL REFERENCES asset_objects(id) ON DELETE RESTRICT,
  lod_key text NOT NULL CHECK (lod_key IN ('original', 'w64', 'w128', 'w256')),
  target_width integer,
  blob_sha256 text NOT NULL REFERENCES asset_blobs(content_sha256) ON DELETE RESTRICT,
  transformer_version text NOT NULL CHECK (transformer_version <> ''),
  quality integer CHECK (quality IS NULL OR quality BETWEEN 1 AND 100),
  PRIMARY KEY (asset_object_id, lod_key),
  CONSTRAINT asset_variants_lod_target_width_check CHECK (
    (lod_key = 'original' AND target_width IS NULL)
    OR (lod_key = 'w64' AND target_width = 64)
    OR (lod_key = 'w128' AND target_width = 128)
    OR (lod_key = 'w256' AND target_width = 256)
  )
);

CREATE TABLE asset_dataset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_dataset_version_id uuid NOT NULL
    REFERENCES hero_catalog_dataset_versions(id) ON DELETE RESTRICT,
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  client_version text,
  provider_version text NOT NULL CHECK (provider_version <> ''),
  lod_policy_version text NOT NULL CHECK (lod_policy_version <> ''),
  source_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_counts) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_dataset_versions_identity UNIQUE
    (catalog_dataset_version_id, manifest_sha256, provider_version, lod_policy_version),
  CONSTRAINT asset_dataset_versions_catalog_pair UNIQUE (catalog_dataset_version_id, id)
);

CREATE TABLE entity_asset_bindings (
  asset_dataset_version_id uuid NOT NULL
    REFERENCES asset_dataset_versions(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN ('hero', 'ability')),
  entity_key text NOT NULL CHECK (entity_key <> ''),
  asset_kind text NOT NULL CHECK (asset_kind = 'icon'),
  asset_object_id uuid NOT NULL REFERENCES asset_objects(id) ON DELETE RESTRICT,
  resolution_kind text NOT NULL CHECK (resolution_kind IN ('exact', 'alias', 'generated_fallback')),
  source_status text NOT NULL CHECK (source_status IN ('available', 'fallback', 'mismatch', 'error')),
  requested_logical_path text NOT NULL CHECK (requested_logical_path <> ''),
  PRIMARY KEY (asset_dataset_version_id, entity_type, entity_key, asset_kind)
);

CREATE TABLE asset_dataset_heads (
  catalog_dataset_version_id uuid PRIMARY KEY
    REFERENCES hero_catalog_dataset_versions(id) ON DELETE RESTRICT,
  asset_dataset_version_id uuid NOT NULL UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_dataset_heads_matching_catalog_fk
    FOREIGN KEY (catalog_dataset_version_id, asset_dataset_version_id)
    REFERENCES asset_dataset_versions(catalog_dataset_version_id, id) ON DELETE RESTRICT
);

CREATE INDEX entity_asset_bindings_object_idx
  ON entity_asset_bindings (asset_object_id);
CREATE INDEX asset_variants_blob_idx ON asset_variants (blob_sha256);

CREATE OR REPLACE FUNCTION promote_asset_dataset_version(target_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_catalog_version_id uuid;
  expected_hero_count bigint;
  actual_hero_count bigint;
  expected_ability_count bigint;
  actual_ability_count bigint;
BEGIN
  SELECT catalog_dataset_version_id
  INTO target_catalog_version_id
  FROM public.asset_dataset_versions
  WHERE id = target_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asset dataset version % does not exist', target_version_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.entity_asset_bindings
    WHERE asset_dataset_version_id = target_version_id
  ) THEN
    RAISE EXCEPTION 'asset dataset version % has no entity bindings', target_version_id;
  END IF;

  SELECT count(*)
  INTO expected_hero_count
  FROM public.heroes
  WHERE dataset_version_id = target_catalog_version_id;

  SELECT count(*)
  INTO actual_hero_count
  FROM public.entity_asset_bindings
  WHERE asset_dataset_version_id = target_version_id
    AND entity_type = 'hero';

  IF actual_hero_count <> expected_hero_count THEN
    RAISE EXCEPTION
      'asset dataset version % has % hero bindings, expected %',
      target_version_id, actual_hero_count, expected_hero_count;
  END IF;

  SELECT count(*)
  INTO expected_ability_count
  FROM public.abilities
  WHERE dataset_version_id = target_catalog_version_id;

  SELECT count(*)
  INTO actual_ability_count
  FROM public.entity_asset_bindings
  WHERE asset_dataset_version_id = target_version_id
    AND entity_type = 'ability';

  IF actual_ability_count <> expected_ability_count THEN
    RAISE EXCEPTION
      'asset dataset version % has % ability bindings, expected %',
      target_version_id, actual_ability_count, expected_ability_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.entity_asset_bindings binding
    WHERE binding.asset_dataset_version_id = target_version_id
      AND 4 <> (
        SELECT count(*)
        FROM public.asset_variants variant
        WHERE variant.asset_object_id = binding.asset_object_id
      )
  ) THEN
    RAISE EXCEPTION
      'asset dataset version % has bindings without all required renditions',
      target_version_id;
  END IF;

  INSERT INTO public.asset_dataset_heads
    (catalog_dataset_version_id, asset_dataset_version_id, updated_at)
  VALUES (target_catalog_version_id, target_version_id, pg_catalog.now())
  ON CONFLICT (catalog_dataset_version_id) DO UPDATE
  SET asset_dataset_version_id = EXCLUDED.asset_dataset_version_id,
      updated_at = EXCLUDED.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION promote_asset_dataset_version(uuid) FROM PUBLIC;

GRANT SELECT, INSERT ON asset_blobs, asset_objects, asset_variants,
  asset_dataset_versions, entity_asset_bindings TO medota2_worker;
GRANT SELECT ON asset_dataset_heads TO medota2_worker;
GRANT EXECUTE ON FUNCTION promote_asset_dataset_version(uuid) TO medota2_worker;

GRANT SELECT ON asset_blobs, asset_objects, asset_variants,
  asset_dataset_versions, entity_asset_bindings, asset_dataset_heads TO medota2_web;
