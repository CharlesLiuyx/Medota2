DO $$
DECLARE
  worker_role name;
  web_role name;
BEGIN
  SELECT environment_identity.worker_role, environment_identity.web_role
  INTO worker_role, web_role
  FROM medota2_control.environment_identity
  WHERE singleton = true
    AND state IN ('active', 'quarantined')
    AND migration_role = current_user;

  IF worker_role IS NULL OR web_role IS NULL THEN
    RAISE EXCEPTION 'environment role marker does not match current migrator';
  END IF;

  EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I, %I', worker_role, web_role);
  EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I, %I', worker_role, web_role);
  EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I, %I', worker_role, web_role);
  EXECUTE format('GRANT USAGE ON SCHEMA public TO %I, %I', worker_role, web_role);

  EXECUTE format(
    'GRANT SELECT ON schema_migrations, source_snapshots, source_snapshot_files, import_runs, ' ||
    'heroes, hero_source_records, hero_roles, hero_localizations, ' ||
    'dataset_heads, reference_snapshots, reference_hero_records, hero_reference_comparisons, ' ||
    'hero_reference_diffs, hero_catalog_dataset_versions, abilities, ability_id_mappings, ' ||
    'ability_localizations, ability_values, hero_ability_bindings, facets, facet_ability_bindings, ' ||
    'entity_source_records, asset_refs, catalog_semantic_diffs, catalog_reviews, catalog_rollbacks, ' ||
    'asset_blobs, asset_objects, asset_variants, asset_dataset_versions, entity_asset_bindings, ' ||
    'asset_dataset_heads TO %I, %I',
    worker_role,
    web_role
  );

  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE ON import_runs TO %I', worker_role
  );
  EXECUTE format(
    'GRANT SELECT, INSERT ON source_snapshots, source_snapshot_files, ' ||
    'heroes, hero_source_records, hero_roles, hero_localizations, reference_snapshots, ' ||
    'reference_hero_records, hero_reference_comparisons, hero_reference_diffs, ' ||
    'hero_catalog_dataset_versions, abilities, ability_id_mappings, ability_localizations, ' ||
    'ability_values, hero_ability_bindings, facets, facet_ability_bindings, entity_source_records, ' ||
    'catalog_semantic_diffs, asset_blobs, asset_objects, asset_variants, ' ||
    'asset_dataset_versions, entity_asset_bindings TO %I',
    worker_role
  );
  EXECUTE format(
    'GRANT SELECT, INSERT, DELETE ON hero_import_staging, catalog_import_staging TO %I',
    worker_role
  );
  EXECUTE format(
    'GRANT USAGE, SELECT ON SEQUENCE hero_reference_diffs_id_seq TO %I',
    worker_role
  );
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION promote_hero_catalog_version(uuid), ' ||
    'promote_hero_catalog_version(uuid, boolean), ' ||
    'review_hero_catalog_version(uuid, text, text), rollback_hero_catalog_version(uuid, text), ' ||
    'promote_asset_dataset_version(uuid) TO %I',
    worker_role
  );

  REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
    FROM medota2_worker, medota2_web;
  REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public
    FROM medota2_worker, medota2_web;
  REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public
    FROM medota2_worker, medota2_web;
  REVOKE USAGE ON SCHEMA public FROM medota2_worker, medota2_web;
END
$$;

ALTER DEFAULT PRIVILEGES REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES REVOKE USAGE ON TYPES FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
