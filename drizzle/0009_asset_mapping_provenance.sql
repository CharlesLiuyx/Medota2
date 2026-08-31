ALTER TABLE asset_dataset_versions
  ADD COLUMN source_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT asset_dataset_versions_source_provenance_check
    CHECK (jsonb_typeof(source_provenance) = 'object');

COMMENT ON COLUMN asset_dataset_versions.source_provenance IS
  'Versioned repository/input provenance for auxiliary asset resolution sources such as dotaconstants Steam image mappings.';
