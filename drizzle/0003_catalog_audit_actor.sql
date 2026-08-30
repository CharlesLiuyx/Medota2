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
  VALUES (target_version_id, review_decision, session_user, review_reason);
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
  VALUES (current_version_id, target_version_id, session_user, rollback_reason);
  UPDATE public.dataset_heads
  SET catalog_dataset_version_id = target_version_id, updated_at = pg_catalog.now()
  WHERE dataset_key = 'hero_catalog';
END;
$$;
