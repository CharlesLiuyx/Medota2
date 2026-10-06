CREATE TABLE unit_asset_dataset_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_dataset_version_id uuid NOT NULL REFERENCES hero_catalog_dataset_versions(id),
  manifest_sha256 text NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  expected_keys text[] NOT NULL CHECK (cardinality(expected_keys) > 0),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_dataset_version_id, manifest_sha256),
  UNIQUE (catalog_dataset_version_id, id)
);
CREATE TABLE unit_asset_bindings (
  dataset_version_id uuid NOT NULL REFERENCES unit_asset_dataset_versions(id),
  unit_key text NOT NULL,
  asset_object_id uuid REFERENCES asset_objects(id),
  resolution text NOT NULL CHECK (resolution IN ('portrait', 'shared_portrait', 'related_icon', 'unavailable')),
  provenance jsonb NOT NULL CHECK (jsonb_typeof(provenance) = 'object'),
  PRIMARY KEY (dataset_version_id, unit_key),
  CHECK ((resolution = 'unavailable') = (asset_object_id IS NULL))
);
CREATE TABLE unit_asset_heads (
  catalog_dataset_version_id uuid PRIMARY KEY REFERENCES hero_catalog_dataset_versions(id),
  dataset_version_id uuid NOT NULL,
  FOREIGN KEY (catalog_dataset_version_id, dataset_version_id)
    REFERENCES unit_asset_dataset_versions(catalog_dataset_version_id, id)
);
CREATE FUNCTION promote_unit_asset_dataset(target uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE catalog_id uuid; expected text[]; actual text[];
BEGIN
  PERFORM pg_advisory_xact_lock(1296389185, 1751740003);
  SELECT catalog_dataset_version_id, expected_keys INTO catalog_id, expected
    FROM unit_asset_dataset_versions WHERE id = target;
  IF catalog_id IS NULL THEN RAISE EXCEPTION 'Unknown unit asset dataset'; END IF;
  SELECT array_agg(unit_key ORDER BY unit_key) INTO actual FROM unit_asset_bindings WHERE dataset_version_id = target;
  IF actual IS DISTINCT FROM (SELECT array_agg(k ORDER BY k) FROM unnest(expected) k) THEN
    RAISE EXCEPTION 'Unit asset coverage does not match source keys';
  END IF;
  IF EXISTS (SELECT 1 FROM unit_asset_bindings b WHERE dataset_version_id = target AND asset_object_id IS NOT NULL
    AND (SELECT count(*) FROM asset_variants v WHERE v.asset_object_id=b.asset_object_id) <> 4) THEN
    RAISE EXCEPTION 'Incomplete unit asset LoDs';
  END IF;
  IF EXISTS (SELECT 1 FROM unit_asset_heads h JOIN unit_asset_bindings old ON old.dataset_version_id=h.dataset_version_id
    LEFT JOIN unit_asset_bindings new ON new.dataset_version_id=target AND new.unit_key=old.unit_key
    WHERE h.catalog_dataset_version_id=catalog_id AND
      (CASE old.resolution WHEN 'portrait' THEN 3 WHEN 'shared_portrait' THEN 2 WHEN 'related_icon' THEN 1 ELSE 0 END) >
      (CASE new.resolution WHEN 'portrait' THEN 3 WHEN 'shared_portrait' THEN 2 WHEN 'related_icon' THEN 1 ELSE 0 END)) THEN
    RAISE EXCEPTION 'Refusing unit asset coverage downgrade';
  END IF;
  INSERT INTO unit_asset_heads VALUES (catalog_id,target)
    ON CONFLICT (catalog_dataset_version_id) DO UPDATE SET dataset_version_id=EXCLUDED.dataset_version_id;
END $$;
REVOKE ALL ON FUNCTION promote_unit_asset_dataset(uuid) FROM PUBLIC;
DO $$
DECLARE worker_role name; web_role name;
BEGIN
  SELECT i.worker_role, i.web_role INTO worker_role, web_role FROM medota2_control.environment_identity i
    WHERE singleton AND migration_role=current_user AND state IN ('active','quarantined');
  IF worker_role IS NULL OR web_role IS NULL THEN RAISE EXCEPTION 'Environment role marker mismatch'; END IF;
  EXECUTE format('GRANT SELECT ON unit_asset_dataset_versions, unit_asset_bindings, unit_asset_heads TO %I, %I', worker_role, web_role);
  EXECUTE format('GRANT INSERT ON unit_asset_dataset_versions, unit_asset_bindings TO %I', worker_role);
  EXECUTE format('GRANT EXECUTE ON FUNCTION promote_unit_asset_dataset(uuid) TO %I', worker_role);
END $$;
