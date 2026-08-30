REVOKE INSERT ON asset_refs FROM medota2_worker;

COMMENT ON TABLE asset_refs IS
  'Legacy catalog asset summary retained for compatibility; authoritative source and resolution state lives in entity_asset_bindings and asset_objects.';

CREATE OR REPLACE FUNCTION promote_hero_catalog_version(
  target_version_id uuid,
  allow_fallback_downgrade boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  target_gate text;
  target_review text;
  target_status text;
  current_catalog_version_id uuid;
  current_exact bigint;
  current_native bigint;
  current_total bigint;
  target_exact bigint;
  target_native bigint;
  target_total bigint;
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
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_locks
    WHERE locktype = 'advisory'
      AND pid = pg_catalog.pg_backend_pid()
      AND classid = 1296389185::oid
      AND objid = 1751740002::oid
      AND objsubid = 2
      AND granted
  ) THEN
    RAISE EXCEPTION 'asset import advisory lock is required for catalog promotion';
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

  SELECT catalog_dataset_version_id
  INTO current_catalog_version_id
  FROM public.dataset_heads
  WHERE dataset_key = 'hero_catalog';

  IF current_catalog_version_id IS NOT NULL
    AND current_catalog_version_id <> target_version_id
    AND NOT COALESCE(allow_fallback_downgrade, false)
  THEN
    SELECT
      count(*) FILTER (WHERE binding.resolution_kind = 'exact'),
      count(*) FILTER (
        WHERE binding.resolution_kind IN ('exact', 'alias')
      ),
      count(*)
    INTO current_exact, current_native, current_total
    FROM public.asset_dataset_heads head
    JOIN public.entity_asset_bindings binding
      ON binding.asset_dataset_version_id = head.asset_dataset_version_id
    WHERE head.catalog_dataset_version_id = current_catalog_version_id
    GROUP BY head.asset_dataset_version_id;

    IF current_total IS NOT NULL AND current_total > 0 THEN
      SELECT
        count(*) FILTER (WHERE binding.resolution_kind = 'exact'),
        count(*) FILTER (
          WHERE binding.resolution_kind IN ('exact', 'alias')
        ),
        count(*)
      INTO target_exact, target_native, target_total
      FROM public.asset_dataset_heads head
      JOIN public.entity_asset_bindings binding
        ON binding.asset_dataset_version_id = head.asset_dataset_version_id
      WHERE head.catalog_dataset_version_id = target_version_id
      GROUP BY head.asset_dataset_version_id;

      IF target_exact * current_total < current_exact * target_total
        OR target_native * current_total < current_native * target_total
      THEN
        RAISE EXCEPTION
          'catalog version % would reduce Valve coverage (exact %/% -> %/%, native %/% -> %/%); pass --allow-fallback-downgrade explicitly',
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

CREATE OR REPLACE FUNCTION promote_hero_catalog_version(target_version_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.promote_hero_catalog_version(target_version_id, false);
END;
$$;

REVOKE ALL ON FUNCTION promote_hero_catalog_version(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION promote_hero_catalog_version(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION promote_hero_catalog_version(uuid, boolean) TO medota2_worker;
GRANT EXECUTE ON FUNCTION promote_hero_catalog_version(uuid) TO medota2_worker;
