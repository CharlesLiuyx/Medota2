import "server-only";
import type { HeroFilters } from "@/server/services/hero-filters";
import { getWebDatabase, getWebPool } from "@/server/db/client";
import { assertSchemaCurrent } from "@/server/db/migrations";

export interface ActiveDatasetMeta {
  datasetVersionId: string;
  assetDatasetVersionId: string;
  clientVersion: string;
  sourceRevision: string;
  sourceCommit: string;
  importedAt: Date;
  promotedAt: Date;
  importerVersion: string;
  schemaVersion: string;
  sourceRepository: string;
  sourceRemoteUrl: string;
  warningCount: number;
  totalHeroes: number;
  totalAbilities: number;
  gateStatus: "green" | "yellow" | "red";
  reviewStatus: "not_required" | "pending" | "approved" | "rejected";
}

export interface LatestImportFailure {
  stage: string;
  errorSummary: string | null;
  issues: Array<{ code?: string; message?: string }>;
  finishedAt: Date;
}

export interface HeroCardRow {
  heroId: number;
  internalName: string;
  slug: string;
  primaryAttribute: string;
  attackType: string;
  faction: string;
  complexity: number;
  cmEnabled: boolean;
  baseStrength: string;
  baseAgility: string;
  baseIntelligence: string;
  movementSpeed: string;
  zhName: string;
  enName: string;
  roles: Array<{ role: string; level: number }>;
}

export interface HeroOverview {
  meta: ActiveDatasetMeta | null;
  heroes: HeroCardRow[];
  latestFailure: LatestImportFailure | null;
}

export interface HeroDetail {
  meta: ActiveDatasetMeta;
  hero: Record<string, string | number | boolean | null> & {
    hero_id: number;
    internal_name: string;
    slug: string;
    source_key: string;
    source_dto_sha256: string;
    inherited_fields: string[];
  };
  roles: Array<{ role: string; role_level: number }>;
  localizations: Array<{
    locale: "en" | "zh-CN";
    display_name: string;
    english_name_variant: string | null;
    hype: string | null;
    lore: string | null;
    name_source_path: string;
    name_token: string;
    english_name_variant_token: string | null;
    hype_source_path: string | null;
    hype_token: string | null;
    lore_source_path: string | null;
    lore_token: string | null;
  }>;
  sourceFiles: Array<{
    source_path: string;
    raw_sha256: string;
    size_bytes: string;
    encoding: string;
  }>;
  abilities: Array<{
    internal_name: string;
    zh_name: string | null;
    en_name: string | null;
    catalog_status: string;
    definition_kind: string;
    is_innate: boolean;
    is_ultimate: boolean;
    has_scepter_upgrade: boolean;
    has_shard_upgrade: boolean;
    relation_kind: string;
    source_slot: string;
    ordinal: number;
    is_current: boolean;
  }>;
  facets: Array<{
    facet_key: string;
    icon: string | null;
    color: string | null;
    gradient_id: number | null;
    deprecated: boolean;
    source_path: string;
    source_line: number;
  }>;
  comparison: null | {
    sourceCommit: string;
    packageVersion: string;
    comparatorVersion: string;
    createdAt: Date;
    diffs: Array<{
      field_name: string;
      diff_type: string;
      canonical_value: unknown;
      reference_value: unknown;
    }>;
  };
}

type ReferenceDiffRow = NonNullable<HeroDetail["comparison"]>["diffs"][number];

let schemaPromise: Promise<string> | undefined;

async function ensureReady(): Promise<void> {
  getWebDatabase();
  schemaPromise ??= assertSchemaCurrent(getWebPool());
  await schemaPromise;
}

export async function getHeroOverview(
  filters: HeroFilters | null,
): Promise<HeroOverview> {
  await ensureReady();
  const pool = getWebPool();
  const meta = await getActiveCatalogMeta();
  const latestFailure = await getLatestFailure(meta?.promotedAt ?? null);
  if (!meta || !filters) return { meta, heroes: [], latestFailure };

  const values: unknown[] = [meta.datasetVersionId];
  const conditions = ["h.dataset_version_id = $1"];
  if (filters.q) {
    values.push(escapeLike(filters.q));
    const index = values.length;
    conditions.push(
      `(zh.display_name ILIKE '%' || $${index} || '%' ESCAPE '\\' OR en.display_name ILIKE '%' || $${index} || '%' ESCAPE '\\' OR h.internal_name ILIKE '%' || $${index} || '%' ESCAPE '\\' OR h.hero_id::text = $${index})`,
    );
  }
  if (filters.attributes.length) {
    values.push(filters.attributes);
    conditions.push(`h.primary_attribute = ANY($${values.length}::text[])`);
  }
  if (filters.attacks.length) {
    values.push(filters.attacks);
    conditions.push(`h.attack_type = ANY($${values.length}::text[])`);
  }
  if (filters.roles.length) {
    values.push(filters.roles);
    conditions.push(
      `EXISTS (SELECT 1 FROM hero_roles selected_role WHERE selected_role.dataset_version_id = h.dataset_version_id AND selected_role.hero_id = h.hero_id AND selected_role.role = ANY($${values.length}::text[]))`,
    );
  }
  if (filters.cm !== "all") {
    values.push(filters.cm === "true");
    conditions.push(`h.cm_enabled = $${values.length}`);
  }

  const result = await pool.query<{
    hero_id: number;
    internal_name: string;
    slug: string;
    primary_attribute: string;
    attack_type: string;
    faction: string;
    complexity: number;
    cm_enabled: boolean;
    base_strength: string;
    base_agility: string;
    base_intelligence: string;
    movement_speed: string;
    zh_name: string;
    en_name: string;
    roles: Array<{ role: string; level: number }>;
  }>(
    `SELECT h.hero_id, h.internal_name, h.slug, h.primary_attribute, h.attack_type,
       h.faction, h.complexity, h.cm_enabled, h.base_strength, h.base_agility,
       h.base_intelligence, h.movement_speed, zh.display_name AS zh_name,
       en.display_name AS en_name,
       COALESCE(jsonb_agg(jsonb_build_object('role', r.role, 'level', r.role_level) ORDER BY r.role_level DESC, r.role)
         FILTER (WHERE r.role IS NOT NULL), '[]'::jsonb) AS roles
     FROM heroes h
     JOIN hero_localizations zh ON zh.dataset_version_id = h.dataset_version_id AND zh.hero_id = h.hero_id AND zh.locale = 'zh-CN'
     JOIN hero_localizations en ON en.dataset_version_id = h.dataset_version_id AND en.hero_id = h.hero_id AND en.locale = 'en'
     LEFT JOIN hero_roles r ON r.dataset_version_id = h.dataset_version_id AND r.hero_id = h.hero_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY h.dataset_version_id, h.hero_id, zh.display_name, en.display_name
     ORDER BY h.hero_id`,
    values,
  );

  return {
    meta,
    latestFailure,
    heroes: result.rows.map((row) => ({
      heroId: row.hero_id,
      internalName: row.internal_name,
      slug: row.slug,
      primaryAttribute: row.primary_attribute,
      attackType: row.attack_type,
      faction: row.faction,
      complexity: row.complexity,
      cmEnabled: row.cm_enabled,
      baseStrength: row.base_strength,
      baseAgility: row.base_agility,
      baseIntelligence: row.base_intelligence,
      movementSpeed: row.movement_speed,
      zhName: row.zh_name,
      enName: row.en_name,
      roles: row.roles,
    })),
  };
}

export async function getHeroBySlug(slug: string): Promise<HeroDetail | null> {
  await ensureReady();
  const pool = getWebPool();
  const meta = await getActiveCatalogMeta();
  if (!meta) return null;
  const heroResult = await pool.query<HeroDetail["hero"]>(
    `SELECT h.*, sr.source_key, sr.source_dto_sha256, sr.inherited_fields
     FROM heroes h
     JOIN hero_source_records sr ON sr.dataset_version_id = h.dataset_version_id AND sr.hero_id = h.hero_id
     WHERE h.dataset_version_id = $1 AND h.slug = $2`,
    [meta.datasetVersionId, slug],
  );
  if (!heroResult.rowCount) return null;
  const hero = heroResult.rows[0];
  const [roles, localizations, files, abilities, facets, comparisonMeta] =
    await Promise.all([
      pool.query<HeroDetail["roles"][number]>(
        "SELECT role, role_level FROM hero_roles WHERE dataset_version_id = $1 AND hero_id = $2 ORDER BY role_level DESC, role",
        [meta.datasetVersionId, hero.hero_id],
      ),
      pool.query<HeroDetail["localizations"][number]>(
        "SELECT * FROM hero_localizations WHERE dataset_version_id = $1 AND hero_id = $2 ORDER BY locale",
        [meta.datasetVersionId, hero.hero_id],
      ),
      pool.query<HeroDetail["sourceFiles"][number]>(
        `SELECT f.source_path, f.raw_sha256, f.size_bytes::text, f.encoding
       FROM source_snapshot_files f
       JOIN hero_catalog_dataset_versions v ON v.source_snapshot_id = f.source_snapshot_id
       WHERE v.id = $1 ORDER BY f.source_path`,
        [meta.datasetVersionId],
      ),
      pool.query<HeroDetail["abilities"][number]>(
        `SELECT a.internal_name, zh.display_name AS zh_name, en.display_name AS en_name,
         a.catalog_status, a.definition_kind, a.is_innate, a.is_ultimate,
         a.has_scepter_upgrade, a.has_shard_upgrade,
         b.relation_kind, b.source_slot, b.ordinal, b.is_current
       FROM hero_ability_bindings b
       JOIN abilities a ON a.dataset_version_id = b.dataset_version_id
         AND a.internal_name = b.ability_internal_name
       LEFT JOIN ability_localizations zh ON zh.dataset_version_id = a.dataset_version_id
         AND zh.ability_internal_name = a.internal_name AND zh.locale = 'zh-CN'
       LEFT JOIN ability_localizations en ON en.dataset_version_id = a.dataset_version_id
         AND en.ability_internal_name = a.internal_name AND en.locale = 'en'
       WHERE b.dataset_version_id = $1 AND b.hero_id = $2
       ORDER BY b.is_current DESC, b.ordinal, b.relation_kind, a.internal_name`,
        [meta.datasetVersionId, hero.hero_id],
      ),
      pool.query<HeroDetail["facets"][number]>(
        `SELECT facet_key, icon, color, gradient_id, deprecated, source_path, source_line
       FROM facets WHERE dataset_version_id = $1 AND hero_id = $2
       ORDER BY deprecated, facet_key`,
        [meta.datasetVersionId, hero.hero_id],
      ),
      pool.query<{
        id: string;
        source_commit: string;
        package_version: string;
        comparator_version: string;
        created_at: Date;
      }>(
        `SELECT c.id, s.source_commit, s.package_version, c.comparator_version, c.created_at
       FROM hero_reference_comparisons c
       JOIN reference_snapshots s ON s.id = c.reference_snapshot_id
       WHERE c.dataset_version_id = $1
       ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
        [meta.datasetVersionId],
      ),
    ]);

  let comparison: HeroDetail["comparison"] = null;
  if (comparisonMeta.rowCount) {
    const current = comparisonMeta.rows[0];
    const diffs = await pool.query<ReferenceDiffRow>(
      `SELECT field_name, diff_type, canonical_value, reference_value
       FROM hero_reference_diffs WHERE comparison_id = $1 AND hero_id = $2 ORDER BY field_name`,
      [current.id, hero.hero_id],
    );
    comparison = {
      sourceCommit: current.source_commit,
      packageVersion: current.package_version,
      comparatorVersion: current.comparator_version,
      createdAt: current.created_at,
      diffs: diffs.rows,
    };
  }

  return {
    meta,
    hero,
    roles: roles.rows,
    localizations: localizations.rows,
    sourceFiles: files.rows,
    abilities: abilities.rows,
    facets: facets.rows,
    comparison,
  };
}

export async function getActiveCatalogMeta(): Promise<ActiveDatasetMeta | null> {
  const result = await getWebPool().query<{
    dataset_version_id: string;
    asset_dataset_version_id: string;
    client_version: string;
    source_revision: string;
    source_commit: string;
    imported_at: Date;
    promoted_at: Date;
    importer_version: string;
    target_schema_version: string;
    source_repository: string;
    source_remote_url: string;
    issues: Array<{ severity?: string }>;
    total_heroes: number;
    total_abilities: number;
    gate_status: ActiveDatasetMeta["gateStatus"];
    review_status: ActiveDatasetMeta["reviewStatus"];
  }>(
    `SELECT v.id AS dataset_version_id,
       asset_head.asset_dataset_version_id,
       s.client_version, s.source_revision, s.source_commit,
       s.imported_at, v.promoted_at, v.importer_version, v.target_schema_version,
       v.gate_status, v.review_status,
       s.source_repository, s.source_remote_url, r.issues,
       (SELECT count(*)::int FROM heroes hero WHERE hero.dataset_version_id = v.id) AS total_heroes,
       (SELECT count(*)::int FROM abilities ability WHERE ability.dataset_version_id = v.id) AS total_abilities
     FROM dataset_heads h
     JOIN hero_catalog_dataset_versions v ON v.id = h.catalog_dataset_version_id
     JOIN asset_dataset_heads asset_head
       ON asset_head.catalog_dataset_version_id = v.id
     JOIN source_snapshots s ON s.id = v.source_snapshot_id
     JOIN import_runs r ON r.id = v.import_run_id
     WHERE h.dataset_key = 'hero_catalog'`,
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    datasetVersionId: row.dataset_version_id,
    assetDatasetVersionId: row.asset_dataset_version_id,
    clientVersion: row.client_version,
    sourceRevision: row.source_revision,
    sourceCommit: row.source_commit,
    importedAt: row.imported_at,
    promotedAt: row.promoted_at,
    importerVersion: row.importer_version,
    schemaVersion: row.target_schema_version,
    sourceRepository: row.source_repository,
    sourceRemoteUrl: row.source_remote_url,
    warningCount: row.issues.filter((issue) => issue.severity === "warning")
      .length,
    totalHeroes: row.total_heroes,
    totalAbilities: row.total_abilities,
    gateStatus: row.gate_status,
    reviewStatus: row.review_status,
  };
}

async function getLatestFailure(
  promotedAt: Date | null,
): Promise<LatestImportFailure | null> {
  const result = await getWebPool().query<{
    stage: string;
    error_summary: string | null;
    issues: LatestImportFailure["issues"];
    finished_at: Date;
  }>(
    `SELECT stage, error_summary, issues, finished_at
     FROM import_runs
     WHERE source_kind = 'vpk' AND status = 'failed' AND finished_at IS NOT NULL
       AND ($1::timestamptz IS NULL OR finished_at > $1)
     ORDER BY finished_at DESC LIMIT 1`,
    [promotedAt],
  );
  if (!result.rowCount) return null;
  return {
    stage: result.rows[0].stage,
    errorSummary: result.rows[0].error_summary,
    issues: result.rows[0].issues,
    finishedAt: result.rows[0].finished_at,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
