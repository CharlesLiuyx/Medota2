CREATE OR REPLACE FUNCTION rollback_hero_catalog_version(
  target_version_id uuid,
  rollback_reason text,
  allow_fallback_downgrade boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  current_version_id uuid;
  target_status text;
  current_exact bigint;
  current_native bigint;
  current_total bigint;
  target_exact bigint;
  target_native bigint;
  target_total bigint;
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks
    WHERE locktype = 'advisory'
      AND pid = pg_catalog.pg_backend_pid()
      AND classid = 1296389185::oid
      AND objid = 1751740002::oid
      AND objsubid = 2
      AND granted
  ) THEN
    RAISE EXCEPTION 'asset import advisory lock is required for catalog rollback';
  END IF;

  SELECT status
  INTO target_status
  FROM public.hero_catalog_dataset_versions
  WHERE id = target_version_id;
  IF target_status NOT IN ('validated', 'promoted') THEN
    RAISE EXCEPTION 'catalog version % is not a validated rollback target', target_version_id;
  END IF;

  SELECT catalog_dataset_version_id
  INTO current_version_id
  FROM public.dataset_heads
  WHERE dataset_key = 'hero_catalog';
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

  IF current_version_id <> target_version_id
    AND NOT COALESCE(allow_fallback_downgrade, false)
  THEN
    SELECT
      count(*) FILTER (WHERE binding.resolution_kind = 'exact'),
      count(*) FILTER (WHERE binding.resolution_kind IN ('exact', 'alias')),
      count(*)
    INTO current_exact, current_native, current_total
    FROM public.asset_dataset_heads head
    JOIN public.entity_asset_bindings binding
      ON binding.asset_dataset_version_id = head.asset_dataset_version_id
    WHERE head.catalog_dataset_version_id = current_version_id
    GROUP BY head.asset_dataset_version_id;

    SELECT
      count(*) FILTER (WHERE binding.resolution_kind = 'exact'),
      count(*) FILTER (WHERE binding.resolution_kind IN ('exact', 'alias')),
      count(*)
    INTO target_exact, target_native, target_total
    FROM public.asset_dataset_heads head
    JOIN public.entity_asset_bindings binding
      ON binding.asset_dataset_version_id = head.asset_dataset_version_id
    WHERE head.catalog_dataset_version_id = target_version_id
    GROUP BY head.asset_dataset_version_id;

    IF current_total IS NOT NULL AND current_total > 0
      AND (
        target_exact * current_total < current_exact * target_total
        OR target_native * current_total < current_native * target_total
      )
    THEN
      RAISE EXCEPTION
        'catalog rollback to % would reduce Valve coverage (exact %/% -> %/%, native %/% -> %/%); pass --allow-fallback-downgrade explicitly',
        target_version_id,
        current_exact,
        current_total,
        target_exact,
        target_total,
        current_native,
        current_total,
        target_native,
        target_total;
    END IF;
  END IF;

  INSERT INTO public.catalog_rollbacks (from_version_id, to_version_id, actor, reason)
  VALUES (current_version_id, target_version_id, session_user, rollback_reason);
  UPDATE public.dataset_heads
  SET catalog_dataset_version_id = target_version_id,
      updated_at = pg_catalog.now()
  WHERE dataset_key = 'hero_catalog';
END;
$$;

REVOKE ALL ON FUNCTION rollback_hero_catalog_version(uuid, text, boolean) FROM PUBLIC;

DO $$
DECLARE
  target_worker name;
BEGIN
  SELECT worker_role
  INTO target_worker
  FROM medota2_control.environment_identity
  WHERE singleton = true;
  IF target_worker IS NULL THEN
    RAISE EXCEPTION 'database environment marker has no worker role';
  END IF;
  EXECUTE pg_catalog.format(
    'REVOKE EXECUTE ON FUNCTION public.rollback_hero_catalog_version(uuid, text) FROM %I',
    target_worker
  );
  EXECUTE pg_catalog.format(
    'GRANT EXECUTE ON FUNCTION public.rollback_hero_catalog_version(uuid, text, boolean) TO %I',
    target_worker
  );
END;
$$;
