import type { PoolClient } from "pg";
import type {
  CatalogProjection,
  CatalogProjectionEntity,
} from "@/domain/catalog-diff";
import { canonicalJsonSha256 } from "@/lib/hash";

interface VersionRow {
  selector_manifest_sha256: string;
}

export async function loadCatalogProjection(
  client: PoolClient,
  datasetVersionId: string,
): Promise<CatalogProjection> {
  const version = await client.query<VersionRow>(
    "SELECT selector_manifest_sha256 FROM hero_catalog_dataset_versions WHERE id = $1",
    [datasetVersionId],
  );
  if (!version.rowCount)
    throw new Error(`Unknown catalog ${datasetVersionId}.`);

  const [heroes, abilities, bindings, idMappings, facets, coverage] =
    await Promise.all([
      client.query<{
        internal_name: string;
        hero_id: number;
        source_dto_sha256: string;
      }>(
        `SELECT h.internal_name, h.hero_id, s.source_dto_sha256
         FROM heroes h
         JOIN hero_source_records s USING (dataset_version_id, hero_id)
         WHERE h.dataset_version_id = $1`,
        [datasetVersionId],
      ),
      client.query<{
        internal_name: string;
        raw_sha256: string;
        resolved_sha256: string;
        catalog_status: string;
        unknown_fields: string[];
        occurrence_count: number;
      }>(
        `SELECT a.internal_name, a.raw_sha256, a.resolved_sha256, a.catalog_status,
           a.unknown_fields,
           count(DISTINCT s.occurrence_ordinal)::int AS occurrence_count
         FROM abilities a
         LEFT JOIN entity_source_records s ON s.dataset_version_id = a.dataset_version_id
           AND s.entity_type = 'ability' AND s.entity_key = a.internal_name
         WHERE a.dataset_version_id = $1
         GROUP BY a.internal_name, a.raw_sha256, a.resolved_sha256, a.catalog_status, a.unknown_fields`,
        [datasetVersionId],
      ),
      client.query<{
        hero_id: number;
        ability_internal_name: string;
        relation_kind: string;
        source_slot: string;
        ordinal: number;
        is_current: boolean;
        source_path: string;
        source_line: number;
      }>(
        "SELECT hero_id, ability_internal_name, relation_kind, source_slot, ordinal, is_current, source_path, source_line FROM hero_ability_bindings WHERE dataset_version_id = $1",
        [datasetVersionId],
      ),
      client.query<{
        internal_name: string;
        ability_id: number;
        source_path: string;
        source_line: number;
      }>(
        "SELECT internal_name, ability_id, source_path, source_line FROM ability_id_mappings WHERE dataset_version_id = $1",
        [datasetVersionId],
      ),
      client.query<{
        hero_id: number;
        facet_key: string;
        raw_definition: unknown;
      }>(
        "SELECT hero_id, facet_key, raw_definition FROM facets WHERE dataset_version_id = $1",
        [datasetVersionId],
      ),
      client.query<{ locale: string; count: number }>(
        `SELECT l.locale, count(*)::int AS count
         FROM ability_localizations l
         JOIN abilities a ON a.dataset_version_id = l.dataset_version_id
           AND a.internal_name = l.ability_internal_name
         WHERE l.dataset_version_id = $1 AND a.catalog_status = 'current' AND l.display_name IS NOT NULL
         GROUP BY l.locale`,
        [datasetVersionId],
      ),
    ]);

  const project = <T>(rows: T[], mapper: (row: T) => CatalogProjectionEntity) =>
    rows.map(mapper);
  return {
    selectorManifestSha256: version.rows[0].selector_manifest_sha256,
    heroes: project(heroes.rows, (row) => ({
      key: row.internal_name,
      fingerprint: canonicalJsonSha256({
        heroId: row.hero_id,
        source: row.source_dto_sha256,
      }),
    })),
    abilities: project(abilities.rows, (row) => ({
      key: row.internal_name,
      fingerprint: canonicalJsonSha256({
        raw: row.raw_sha256,
        resolved: row.resolved_sha256,
        status: row.catalog_status,
      }),
      unknownFields: row.unknown_fields,
      occurrenceCount: row.occurrence_count,
    })),
    bindings: project(bindings.rows, (row) => ({
      key: [
        row.hero_id,
        row.ability_internal_name,
        row.relation_kind,
        row.source_slot,
      ].join("\u001f"),
      fingerprint: canonicalJsonSha256({
        ordinal: row.ordinal,
        current: row.is_current,
        path: row.source_path,
        line: row.source_line,
      }),
    })),
    idMappings: project(idMappings.rows, (row) => ({
      key: [row.internal_name, row.ability_id].join("\u001f"),
      fingerprint: canonicalJsonSha256({
        path: row.source_path,
        line: row.source_line,
      }),
    })),
    facets: project(facets.rows, (row) => ({
      key: [row.hero_id, row.facet_key].join("\u001f"),
      fingerprint: canonicalJsonSha256(row.raw_definition),
    })),
    localizationCoverage: Object.fromEntries(
      coverage.rows.map((row) => [row.locale, row.count]),
    ),
  };
}
