CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

ALTER TABLE asset_blobs
  ADD CONSTRAINT asset_blobs_content_sha256_matches_content
  CHECK (
    pg_catalog.encode(public.digest(content, 'sha256'), 'hex') = content_sha256
  );

CREATE OR REPLACE FUNCTION asset_dataset_version_is_complete(
  target_catalog_version_id uuid,
  target_asset_dataset_version_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.asset_dataset_versions dataset
    WHERE dataset.id = target_asset_dataset_version_id
      AND dataset.catalog_dataset_version_id = target_catalog_version_id
      AND EXISTS (
        SELECT 1
        FROM public.entity_asset_bindings binding
        WHERE binding.asset_dataset_version_id = target_asset_dataset_version_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.heroes hero
        WHERE hero.dataset_version_id = target_catalog_version_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.entity_asset_bindings binding
            WHERE binding.asset_dataset_version_id = target_asset_dataset_version_id
              AND binding.entity_type = 'hero'
              AND binding.entity_key = hero.internal_name
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.entity_asset_bindings binding
        WHERE binding.asset_dataset_version_id = target_asset_dataset_version_id
          AND binding.entity_type = 'hero'
          AND NOT EXISTS (
            SELECT 1
            FROM public.heroes hero
            WHERE hero.dataset_version_id = target_catalog_version_id
              AND hero.internal_name = binding.entity_key
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.abilities ability
        WHERE ability.dataset_version_id = target_catalog_version_id
          AND NOT EXISTS (
            SELECT 1
            FROM public.entity_asset_bindings binding
            WHERE binding.asset_dataset_version_id = target_asset_dataset_version_id
              AND binding.entity_type = 'ability'
              AND binding.entity_key = ability.internal_name
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.entity_asset_bindings binding
        WHERE binding.asset_dataset_version_id = target_asset_dataset_version_id
          AND binding.entity_type = 'ability'
          AND NOT EXISTS (
            SELECT 1
            FROM public.abilities ability
            WHERE ability.dataset_version_id = target_catalog_version_id
              AND ability.internal_name = binding.entity_key
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.entity_asset_bindings binding
        WHERE binding.asset_dataset_version_id = target_asset_dataset_version_id
          AND EXISTS (
            SELECT 1
            FROM public.asset_objects object
            WHERE object.id = binding.asset_object_id
              AND object.source_type <> binding.resolution_kind
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.entity_asset_bindings binding
        WHERE binding.asset_dataset_version_id = target_asset_dataset_version_id
          AND 4 <> (
            SELECT count(*)
            FROM public.asset_variants variant
            WHERE variant.asset_object_id = binding.asset_object_id
          )
      )
  );
$$;

CREATE OR REPLACE FUNCTION promote_asset_dataset_version(target_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_catalog_version_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_locks
    WHERE locktype = 'advisory'
      AND pid = pg_catalog.pg_backend_pid()
      AND classid = 1296389185::oid
      AND objid = 1751740002::oid
      AND objsubid = 2
      AND granted
  ) THEN
    RAISE EXCEPTION 'asset import advisory lock is required';
  END IF;

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

  IF EXISTS (
    SELECT 1
    FROM public.heroes hero
    WHERE hero.dataset_version_id = target_catalog_version_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.entity_asset_bindings binding
        WHERE binding.asset_dataset_version_id = target_version_id
          AND binding.entity_type = 'hero'
          AND binding.entity_key = hero.internal_name
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.entity_asset_bindings binding
    WHERE binding.asset_dataset_version_id = target_version_id
      AND binding.entity_type = 'hero'
      AND NOT EXISTS (
        SELECT 1
        FROM public.heroes hero
        WHERE hero.dataset_version_id = target_catalog_version_id
          AND hero.internal_name = binding.entity_key
      )
  ) THEN
    RAISE EXCEPTION
      'asset dataset version % hero entity keys do not match its catalog',
      target_version_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.abilities ability
    WHERE ability.dataset_version_id = target_catalog_version_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.entity_asset_bindings binding
        WHERE binding.asset_dataset_version_id = target_version_id
          AND binding.entity_type = 'ability'
          AND binding.entity_key = ability.internal_name
      )
  ) OR EXISTS (
    SELECT 1
    FROM public.entity_asset_bindings binding
    WHERE binding.asset_dataset_version_id = target_version_id
      AND binding.entity_type = 'ability'
      AND NOT EXISTS (
        SELECT 1
        FROM public.abilities ability
        WHERE ability.dataset_version_id = target_catalog_version_id
          AND ability.internal_name = binding.entity_key
      )
  ) THEN
    RAISE EXCEPTION
      'asset dataset version % ability entity keys do not match its catalog',
      target_version_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.entity_asset_bindings binding
    WHERE binding.asset_dataset_version_id = target_version_id
      AND EXISTS (
        SELECT 1
        FROM public.asset_objects object
        WHERE object.id = binding.asset_object_id
          AND object.source_type <> binding.resolution_kind
      )
  ) THEN
    RAISE EXCEPTION
      'asset dataset version % has bindings whose resolution kind does not match the asset source type',
      target_version_id;
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
  IF NOT EXISTS (
    SELECT 1
    FROM public.asset_dataset_heads head
    WHERE head.catalog_dataset_version_id = target_version_id
      AND public.asset_dataset_version_is_complete(
        target_version_id,
        head.asset_dataset_version_id
      )
  ) THEN
    RAISE EXCEPTION
      'catalog version % does not have a matching complete asset head',
      target_version_id;
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

CREATE OR REPLACE FUNCTION rollback_hero_catalog_version(
  target_version_id uuid,
  rollback_reason text
)
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
  IF NOT EXISTS (
    SELECT 1
    FROM public.asset_dataset_heads head
    WHERE head.catalog_dataset_version_id = target_version_id
      AND public.asset_dataset_version_is_complete(
        target_version_id,
        head.asset_dataset_version_id
      )
  ) THEN
    RAISE EXCEPTION
      'catalog version % does not have a matching complete asset head',
      target_version_id;
  END IF;

  INSERT INTO public.catalog_rollbacks (from_version_id, to_version_id, actor, reason)
  VALUES (current_version_id, target_version_id, session_user, rollback_reason);
  UPDATE public.dataset_heads
  SET catalog_dataset_version_id = target_version_id, updated_at = pg_catalog.now()
  WHERE dataset_key = 'hero_catalog';
END;
$$;

REVOKE ALL ON FUNCTION asset_dataset_version_is_complete(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION promote_asset_dataset_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION promote_hero_catalog_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION rollback_hero_catalog_version(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION promote_asset_dataset_version(uuid) TO medota2_worker;
GRANT EXECUTE ON FUNCTION promote_hero_catalog_version(uuid) TO medota2_worker;
GRANT EXECUTE ON FUNCTION rollback_hero_catalog_version(uuid, text) TO medota2_worker;
