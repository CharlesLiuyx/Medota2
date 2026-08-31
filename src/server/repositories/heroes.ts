import "server-only";
import {
  CATALOG_SLICE_LIMIT,
  type CatalogSlice,
} from "@/domain/catalog-stream";
import { PRIMARY_ATTRIBUTES, type PrimaryAttribute } from "@/domain/heroes";
import { getWebDatabase } from "@/server/db/client";
import { assertSchemaCurrent } from "@/server/db/migrations";
import type { VerifiedDatabase } from "@/server/environment/contract";
import {
  assertListCursorMatches,
  createListFilterIdentity,
  decodeListCursor,
  encodeListCursor,
  isListDatasetVersionId,
  ListDatasetUnavailableError,
  ListRequestError,
  type HeroListCursor,
  type ListSliceRequest,
} from "@/server/services/catalog-cursor";
import {
  canonicalHeroQuery,
  type HeroFilters,
} from "@/server/services/hero-filters";

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
  slice: CatalogSlice<HeroCardRow> | null;
  heroes: HeroCardRow[];
  total: number;
  groupCounts: HeroGroupCounts;
  latestFailure: LatestImportFailure | null;
}

export type HeroGroupCounts = Record<PrimaryAttribute, number>;

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

async function ensureReady(): Promise<VerifiedDatabase> {
  const database = await getWebDatabase();
  schemaPromise ??= assertSchemaCurrent(database);
  await schemaPromise;
  return database;
}

export async function getHeroOverview(
  filters: HeroFilters | null,
): Promise<HeroOverview> {
  await ensureReady();
  const meta = await getActiveCatalogMeta();
  const latestFailure = await getLatestFailure(meta?.promotedAt ?? null);
  if (!meta) {
    return {
      meta,
      slice: null,
      heroes: [],
      total: 0,
      groupCounts: emptyHeroGroupCounts(),
      latestFailure,
    };
  }
  if (!filters) {
    const slice = emptyHeroSlice(meta);
    return {
      meta,
      slice,
      heroes: [],
      total: 0,
      groupCounts: emptyHeroGroupCounts(),
      latestFailure,
    };
  }
  const slice = await getHeroCatalogSlice(filters, {
    catalogDatasetVersionId: meta.datasetVersionId,
    assetDatasetVersionId: meta.assetDatasetVersionId,
  });
  return {
    meta,
    slice,
    heroes: slice.items,
    total: slice.total ?? 0,
    groupCounts: {
      ...emptyHeroGroupCounts(),
      ...(slice.groupCounts ?? {}),
    },
    latestFailure,
  };
}

export async function getHeroCatalogSlice(
  filters: HeroFilters,
  request: ListSliceRequest = {},
): Promise<CatalogSlice<HeroCardRow>> {
  const database = await ensureReady();
  const resolved = await resolveHeroSliceRequest(filters, request);
  const query = buildHeroFilterQuery(filters, resolved.catalogDatasetVersionId);
  const countValues = [...query.values];
  const countConditions = [...query.conditions];
  if (resolved.cursor) {
    query.values.push(resolved.cursor.sort[0], resolved.cursor.sort[1]);
    const rankIndex = query.values.length - 1;
    const heroIdIndex = query.values.length;
    query.conditions.push(
      `(${HERO_ATTRIBUTE_RANK_SQL}, h.hero_id) ${resolved.direction === "after" ? ">" : "<"} ($${rankIndex}::integer, $${heroIdIndex}::integer)`,
    );
  }
  query.values.push(CATALOG_SLICE_LIMIT + 1);
  const limitIndex = query.values.length;
  const order = resolved.direction === "before" ? "DESC" : "ASC";

  const rowsPromise = database.query<HeroCardQueryRow>(
    `WITH selected AS (
       SELECT h.hero_id, ${HERO_ATTRIBUTE_RANK_SQL} AS attribute_rank
       FROM heroes h ${query.localizationJoins}
       WHERE ${query.conditions.join(" AND ")}
       ORDER BY ${HERO_ATTRIBUTE_RANK_SQL} ${order}, h.hero_id ${order}
       LIMIT $${limitIndex}
     )
     SELECT h.hero_id, selected.attribute_rank, h.internal_name, h.slug,
       h.primary_attribute, h.attack_type, h.faction, h.complexity, h.cm_enabled,
       h.base_strength, h.base_agility, h.base_intelligence, h.movement_speed,
       zh.display_name AS zh_name, en.display_name AS en_name,
       COALESCE(jsonb_agg(jsonb_build_object('role', r.role, 'level', r.role_level)
         ORDER BY r.role_level DESC, r.role) FILTER (WHERE r.role IS NOT NULL), '[]'::jsonb) AS roles
     FROM selected
     JOIN heroes h ON h.dataset_version_id = $1 AND h.hero_id = selected.hero_id
     JOIN hero_localizations zh ON zh.dataset_version_id = h.dataset_version_id
       AND zh.hero_id = h.hero_id AND zh.locale = 'zh-CN'
     JOIN hero_localizations en ON en.dataset_version_id = h.dataset_version_id
       AND en.hero_id = h.hero_id AND en.locale = 'en'
     LEFT JOIN hero_roles r ON r.dataset_version_id = h.dataset_version_id AND r.hero_id = h.hero_id
     GROUP BY h.dataset_version_id, h.hero_id, selected.attribute_rank,
       zh.display_name, en.display_name
     ORDER BY selected.attribute_rank ${order}, h.hero_id ${order}`,
    query.values,
  );
  const countsPromise = resolved.direction
    ? null
    : database.query<{ primary_attribute: string; count: number }>(
        `SELECT h.primary_attribute, count(*)::int AS count
         FROM heroes h ${query.localizationJoins}
         WHERE ${countConditions.join(" AND ")}
         GROUP BY h.primary_attribute`,
        countValues,
      );
  const [result, countsResult] = await Promise.all([
    rowsPromise,
    countsPromise,
  ]);
  const hasMore = result.rows.length > CATALOG_SLICE_LIMIT;
  let selectedRows = result.rows.slice(0, CATALOG_SLICE_LIMIT);
  if (resolved.direction === "before") selectedRows = selectedRows.reverse();

  const first = selectedRows[0];
  const last = selectedRows.at(-1);
  const identity = {
    version: 1 as const,
    entityKind: "heroes" as const,
    catalogDatasetVersionId: resolved.catalogDatasetVersionId,
    assetDatasetVersionId: resolved.assetDatasetVersionId,
    locale: filters.lang,
    filterIdentity: resolved.filterIdentity,
  };
  const previousCursor =
    first &&
    (resolved.direction === "after" ||
      (resolved.direction === "before" && hasMore))
      ? encodeListCursor({
          ...identity,
          sort: [first.attribute_rank, first.hero_id],
        })
      : null;
  const nextCursor =
    last && (resolved.direction === "before" || hasMore)
      ? encodeListCursor({
          ...identity,
          sort: [last.attribute_rank, last.hero_id],
        })
      : null;
  const groupCounts = countsResult
    ? countsResult.rows.reduce<HeroGroupCounts>((counts, row) => {
        if (
          PRIMARY_ATTRIBUTES.includes(row.primary_attribute as PrimaryAttribute)
        ) {
          counts[row.primary_attribute as PrimaryAttribute] = row.count;
        }
        return counts;
      }, emptyHeroGroupCounts())
    : undefined;

  return {
    items: selectedRows.map(mapHeroCardRow),
    datasetVersionId: resolved.catalogDatasetVersionId,
    assetDatasetVersionId: resolved.assetDatasetVersionId,
    previousCursor,
    nextCursor,
    ...(groupCounts
      ? {
          total: Object.values(groupCounts).reduce(
            (sum, count) => sum + count,
            0,
          ),
          groupCounts,
        }
      : {}),
  };
}

const HERO_ATTRIBUTE_RANK_SQL = `CASE h.primary_attribute
  WHEN 'strength' THEN 0
  WHEN 'agility' THEN 1
  WHEN 'intelligence' THEN 2
  WHEN 'universal' THEN 3
  ELSE 4 END`;

interface HeroFilterQuery {
  values: unknown[];
  conditions: string[];
  localizationJoins: string;
}

interface HeroCardQueryRow {
  hero_id: number;
  attribute_rank: number;
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
  roles: HeroCardRow["roles"];
}

interface ResolvedHeroSliceRequest {
  catalogDatasetVersionId: string;
  assetDatasetVersionId: string;
  filterIdentity: string;
  direction: "after" | "before" | null;
  cursor: HeroListCursor | null;
}

function buildHeroFilterQuery(
  filters: HeroFilters,
  catalogDatasetVersionId: string,
): HeroFilterQuery {
  const values: unknown[] = [catalogDatasetVersionId];
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
  const localizationJoins = `JOIN hero_localizations zh ON zh.dataset_version_id = h.dataset_version_id AND zh.hero_id = h.hero_id AND zh.locale = 'zh-CN'
    JOIN hero_localizations en ON en.dataset_version_id = h.dataset_version_id AND en.hero_id = h.hero_id AND en.locale = 'en'`;
  return { values, conditions, localizationJoins };
}

async function resolveHeroSliceRequest(
  filters: HeroFilters,
  request: ListSliceRequest,
): Promise<ResolvedHeroSliceRequest> {
  if (request.after !== undefined && request.before !== undefined) {
    throw new ListRequestError("after 与 before 不能同时提供。");
  }
  if (
    (request.catalogDatasetVersionId === undefined) !==
    (request.assetDatasetVersionId === undefined)
  ) {
    throw new ListRequestError("Catalog 与 asset dataset 必须成对提供。");
  }
  if (
    (request.catalogDatasetVersionId !== undefined &&
      !isListDatasetVersionId(request.catalogDatasetVersionId)) ||
    (request.assetDatasetVersionId !== undefined &&
      !isListDatasetVersionId(request.assetDatasetVersionId))
  ) {
    throw new ListRequestError("dataset version 格式无效。");
  }
  const filterIdentity = createListFilterIdentity(canonicalHeroQuery(filters));
  const encoded = request.after ?? request.before;
  if (encoded !== undefined) {
    const decoded = decodeListCursor(encoded);
    assertListCursorMatches(decoded, {
      entityKind: "heroes",
      locale: filters.lang,
      filterIdentity,
      catalogDatasetVersionId: request.catalogDatasetVersionId,
      assetDatasetVersionId: request.assetDatasetVersionId,
    });
    const cursor = decoded as HeroListCursor;
    await assertCatalogDatasetPairAvailable(
      cursor.catalogDatasetVersionId,
      cursor.assetDatasetVersionId,
    );
    return {
      catalogDatasetVersionId: cursor.catalogDatasetVersionId,
      assetDatasetVersionId: cursor.assetDatasetVersionId,
      filterIdentity,
      direction: request.after !== undefined ? "after" : "before",
      cursor,
    };
  }

  let catalogDatasetVersionId = request.catalogDatasetVersionId;
  let assetDatasetVersionId = request.assetDatasetVersionId;
  if (!catalogDatasetVersionId || !assetDatasetVersionId) {
    const meta = await getActiveCatalogMeta();
    if (!meta) throw new ListDatasetUnavailableError("当前 Catalog 尚未发布。");
    catalogDatasetVersionId = meta.datasetVersionId;
    assetDatasetVersionId = meta.assetDatasetVersionId;
  }
  await assertCatalogDatasetPairAvailable(
    catalogDatasetVersionId,
    assetDatasetVersionId,
  );
  return {
    catalogDatasetVersionId,
    assetDatasetVersionId,
    filterIdentity,
    direction: null,
    cursor: null,
  };
}

function emptyHeroSlice(meta: ActiveDatasetMeta): CatalogSlice<HeroCardRow> {
  return {
    items: [],
    datasetVersionId: meta.datasetVersionId,
    assetDatasetVersionId: meta.assetDatasetVersionId,
    previousCursor: null,
    nextCursor: null,
    total: 0,
    groupCounts: emptyHeroGroupCounts(),
  };
}

function emptyHeroGroupCounts(): HeroGroupCounts {
  return {
    strength: 0,
    agility: 0,
    intelligence: 0,
    universal: 0,
  };
}

function mapHeroCardRow(row: HeroCardQueryRow): HeroCardRow {
  return {
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
  };
}

export async function getHeroBySlug(slug: string): Promise<HeroDetail | null> {
  const pool = await ensureReady();
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
  const database = await ensureReady();
  const result = await database.query<{
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

export async function assertCatalogDatasetPairAvailable(
  catalogDatasetVersionId: string,
  assetDatasetVersionId: string,
): Promise<void> {
  const database = await ensureReady();
  const result = await database.query<{ available: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM hero_catalog_dataset_versions catalog
       JOIN asset_dataset_versions assets
         ON assets.catalog_dataset_version_id = catalog.id
       WHERE catalog.id = $1 AND assets.id = $2
     ) AS available`,
    [catalogDatasetVersionId, assetDatasetVersionId],
  );
  if (!result.rows[0]?.available) throw new ListDatasetUnavailableError();
}

async function getLatestFailure(
  promotedAt: Date | null,
): Promise<LatestImportFailure | null> {
  const database = await ensureReady();
  const result = await database.query<{
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
