import "server-only";

import {
  CATALOG_SLICE_LIMIT,
  type CatalogSlice,
} from "@/domain/catalog-stream";
import { getWebDatabase } from "@/server/db/client";
import { assertSchemaCurrent } from "@/server/db/migrations";
import type { VerifiedDatabase } from "@/server/environment/contract";
import {
  canonicalAbilityQuery,
  type AbilityFilters,
} from "@/server/services/ability-filters";
import {
  assertListCursorMatches,
  createListFilterIdentity,
  decodeListCursor,
  encodeListCursor,
  isListDatasetVersionId,
  ListDatasetUnavailableError,
  ListRequestError,
  type AbilityListCursor,
  type ListSliceRequest,
} from "@/server/services/catalog-cursor";
import {
  assertCatalogDatasetPairAvailable,
  getActiveCatalogMeta,
  type ActiveDatasetMeta,
} from "./heroes";

let schemaPromise: Promise<string> | undefined;

export interface AbilityCardRow {
  internalName: string;
  displayName: string;
  fallbackName: string | null;
  catalogStatus: string;
  definitionKind: string;
  behavior: string[];
  damageType: string | null;
  isInnate: boolean;
  isUltimate: boolean;
  isPassive: boolean;
  hasScepterUpgrade: boolean;
  hasShardUpgrade: boolean;
  cooldown: string | null;
  manaCost: string | null;
  textureName: string;
  owners: Array<{
    heroId: number;
    slug: string;
    internalName: string;
    displayName: string;
    relationKind: string;
  }>;
}

export interface AbilityOverview {
  meta: ActiveDatasetMeta | null;
  slice: CatalogSlice<AbilityCardRow> | null;
  abilities: AbilityCardRow[];
  total: number;
}

export interface AbilityDetail {
  meta: ActiveDatasetMeta;
  ability: Record<string, unknown> & {
    internal_name: string;
    texture_name: string;
    catalog_status: string;
    definition_kind: string;
    unknown_fields: string[];
  };
  localizations: Array<{
    locale: string;
    display_name: string | null;
    description: string | null;
    lore: string | null;
    scepter_description: string | null;
    shard_description: string | null;
    source_path: string;
    name_token: string;
  }>;
  values: Array<{
    value_key: string;
    ordinal: number;
    scalar_value: string | null;
    level_values: string[];
    modifiers: Array<{ key: string; value: unknown; line: number }>;
    raw_value: unknown;
  }>;
  idMappings: Array<{
    ability_id: number;
    source_path: string;
    source_line: number;
  }>;
  bindings: Array<{
    hero_id: number;
    hero_internal_name: string;
    slug: string;
    hero_name: string;
    relation_kind: string;
    source_slot: string;
    ordinal: number;
    is_current: boolean;
    source_path: string;
    source_line: number;
  }>;
  sources: Array<{
    occurrence_ordinal: number;
    source_path: string;
    source_line: number | null;
    declaration_kind: string | null;
    raw_definition: unknown;
    resolved_definition: unknown;
    raw_sha256: string;
    resolved_sha256: string | null;
    unknown_fields: string[];
  }>;
}

async function ensureReady(): Promise<VerifiedDatabase> {
  const database = await getWebDatabase();
  schemaPromise ??= assertSchemaCurrent(database);
  await schemaPromise;
  return database;
}

export async function getAbilityOverview(
  filters: AbilityFilters | null,
): Promise<AbilityOverview> {
  await ensureReady();
  const meta = await getActiveCatalogMeta();
  if (!meta) return { meta, slice: null, abilities: [], total: 0 };
  if (!filters) {
    const slice = emptyAbilitySlice(meta);
    return { meta, slice, abilities: [], total: 0 };
  }
  const slice = await getAbilityCatalogSlice(filters, {
    catalogDatasetVersionId: meta.datasetVersionId,
    assetDatasetVersionId: meta.assetDatasetVersionId,
  });
  return {
    meta,
    slice,
    abilities: slice.items,
    total: slice.total ?? 0,
  };
}

export async function getAbilityCatalogSlice(
  filters: AbilityFilters,
  request: ListSliceRequest = {},
): Promise<CatalogSlice<AbilityCardRow>> {
  const database = await ensureReady();
  const resolved = await resolveAbilitySliceRequest(filters, request);
  const query = buildAbilityFilterQuery(
    filters,
    resolved.catalogDatasetVersionId,
  );
  const countValues = [...query.values];
  const countConditions = [...query.conditions];
  if (resolved.cursor) {
    query.values.push(resolved.cursor.sort[0], resolved.cursor.sort[1]);
    const sortNameIndex = query.values.length - 1;
    const internalNameIndex = query.values.length;
    query.conditions.push(
      `(${ABILITY_SORT_NAME_SQL} COLLATE "C", a.internal_name COLLATE "C") ${resolved.direction === "after" ? ">" : "<"} ($${sortNameIndex}::text COLLATE "C", $${internalNameIndex}::text COLLATE "C")`,
    );
  }
  query.values.push(CATALOG_SLICE_LIMIT + 1);
  const limitIndex = query.values.length;
  const order = resolved.direction === "before" ? "DESC" : "ASC";

  const rowsPromise = database.query<AbilityCardQueryRow>(
    `WITH selected AS (
       SELECT a.internal_name, ${ABILITY_SORT_NAME_SQL} AS localized_sort_name
       FROM abilities a ${query.localizationJoins}
       WHERE ${query.conditions.join(" AND ")}
       ORDER BY ${ABILITY_SORT_NAME_SQL} COLLATE "C" ${order}, a.internal_name COLLATE "C" ${order}
       LIMIT $${limitIndex}
     )
     SELECT a.internal_name, selected.localized_sort_name,
       COALESCE(req.display_name, en.display_name, a.internal_name) AS display_name,
       CASE WHEN req.display_name IS NULL THEN en.display_name ELSE NULL END AS fallback_name,
       a.catalog_status, a.definition_kind, a.behavior, a.damage_type, a.is_innate,
       a.is_ultimate, a.is_passive, a.has_scepter_upgrade, a.has_shard_upgrade,
       a.cooldown, a.mana_cost, a.texture_name,
       COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
         'heroId', h.hero_id, 'slug', h.slug, 'internalName', h.internal_name,
         'displayName', COALESCE(hl_req.display_name, hl_en.display_name, h.internal_name),
         'relationKind', b.relation_kind)) FILTER (WHERE h.hero_id IS NOT NULL), '[]'::jsonb) AS owners
     FROM selected
     JOIN abilities a ON a.dataset_version_id = $1 AND a.internal_name = selected.internal_name
     LEFT JOIN ability_localizations req ON req.dataset_version_id = a.dataset_version_id
       AND req.ability_internal_name = a.internal_name AND req.locale = $2
     LEFT JOIN ability_localizations en ON en.dataset_version_id = a.dataset_version_id
       AND en.ability_internal_name = a.internal_name AND en.locale = 'en'
     LEFT JOIN hero_ability_bindings b ON b.dataset_version_id = a.dataset_version_id
       AND b.ability_internal_name = a.internal_name AND b.is_current
     LEFT JOIN heroes h ON h.dataset_version_id = b.dataset_version_id AND h.hero_id = b.hero_id
     LEFT JOIN hero_localizations hl_req ON hl_req.dataset_version_id = h.dataset_version_id
       AND hl_req.hero_id = h.hero_id AND hl_req.locale = $2
     LEFT JOIN hero_localizations hl_en ON hl_en.dataset_version_id = h.dataset_version_id
       AND hl_en.hero_id = h.hero_id AND hl_en.locale = 'en'
     GROUP BY a.dataset_version_id, a.internal_name, selected.localized_sort_name,
       req.display_name, en.display_name
     ORDER BY selected.localized_sort_name COLLATE "C" ${order}, a.internal_name COLLATE "C" ${order}`,
    query.values,
  );
  const totalPromise = resolved.direction
    ? null
    : database.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM abilities a ${query.localizationJoins}
         WHERE ${countConditions.join(" AND ")}`,
        countValues,
      );
  const [result, totalResult] = await Promise.all([rowsPromise, totalPromise]);
  const hasMore = result.rows.length > CATALOG_SLICE_LIMIT;
  let selectedRows = result.rows.slice(0, CATALOG_SLICE_LIMIT);
  if (resolved.direction === "before") selectedRows = selectedRows.reverse();

  const first = selectedRows[0];
  const last = selectedRows.at(-1);
  const identity = {
    version: 1 as const,
    entityKind: "abilities" as const,
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
          sort: [first.localized_sort_name, first.internal_name],
        })
      : null;
  const nextCursor =
    last && (resolved.direction === "before" || hasMore)
      ? encodeListCursor({
          ...identity,
          sort: [last.localized_sort_name, last.internal_name],
        })
      : null;

  return {
    items: selectedRows.map(mapAbilityCardRow),
    datasetVersionId: resolved.catalogDatasetVersionId,
    assetDatasetVersionId: resolved.assetDatasetVersionId,
    previousCursor,
    nextCursor,
    ...(totalResult ? { total: totalResult.rows[0]?.count ?? 0 } : {}),
  };
}

const ABILITY_SORT_NAME_SQL =
  "COALESCE(req.display_name, en.display_name, a.internal_name)";

interface AbilityFilterQuery {
  values: unknown[];
  conditions: string[];
  localizationJoins: string;
}

interface AbilityCardQueryRow {
  internal_name: string;
  localized_sort_name: string;
  display_name: string;
  fallback_name: string | null;
  catalog_status: string;
  definition_kind: string;
  behavior: string[];
  damage_type: string | null;
  is_innate: boolean;
  is_ultimate: boolean;
  is_passive: boolean;
  has_scepter_upgrade: boolean;
  has_shard_upgrade: boolean;
  cooldown: string | null;
  mana_cost: string | null;
  texture_name: string;
  owners: AbilityCardRow["owners"];
}

interface ResolvedAbilitySliceRequest {
  catalogDatasetVersionId: string;
  assetDatasetVersionId: string;
  filterIdentity: string;
  direction: "after" | "before" | null;
  cursor: AbilityListCursor | null;
}

function buildAbilityFilterQuery(
  filters: AbilityFilters,
  catalogDatasetVersionId: string,
): AbilityFilterQuery {
  const values: unknown[] = [catalogDatasetVersionId, filters.lang];
  const conditions = ["a.dataset_version_id = $1"];
  if (filters.status !== "all") {
    values.push(filters.status);
    conditions.push(`a.catalog_status = $${values.length}`);
  }
  if (filters.q) {
    values.push(escapeLike(filters.q));
    conditions.push(
      `(a.internal_name ILIKE '%' || $${values.length} || '%' ESCAPE '\\' OR req.display_name ILIKE '%' || $${values.length} || '%' ESCAPE '\\' OR en.display_name ILIKE '%' || $${values.length} || '%' ESCAPE '\\')`,
    );
  }
  if (filters.hero) {
    values.push(filters.hero);
    conditions.push(
      `EXISTS (SELECT 1 FROM hero_ability_bindings selected_binding JOIN heroes selected_hero ON selected_hero.dataset_version_id = selected_binding.dataset_version_id AND selected_hero.hero_id = selected_binding.hero_id WHERE selected_binding.dataset_version_id = a.dataset_version_id AND selected_binding.ability_internal_name = a.internal_name AND (selected_hero.internal_name = $${values.length} OR selected_hero.slug = $${values.length}))`,
    );
  }
  if (filters.relation !== "all") {
    values.push(filters.relation);
    conditions.push(
      `EXISTS (SELECT 1 FROM hero_ability_bindings selected_relation WHERE selected_relation.dataset_version_id = a.dataset_version_id AND selected_relation.ability_internal_name = a.internal_name AND selected_relation.relation_kind = $${values.length})`,
    );
  }
  if (filters.behavior) {
    values.push(filters.behavior);
    conditions.push(`$${values.length} = ANY(a.behavior)`);
  }
  if (filters.damage) {
    values.push(filters.damage);
    conditions.push(`a.damage_type = $${values.length}`);
  }
  if (filters.upgrade === "scepter") conditions.push("a.has_scepter_upgrade");
  if (filters.upgrade === "shard") conditions.push("a.has_shard_upgrade");
  if (filters.upgrade === "granted") {
    conditions.push("(a.is_granted_by_scepter OR a.is_granted_by_shard)");
  }
  const localizationJoins = `LEFT JOIN ability_localizations req ON req.dataset_version_id = a.dataset_version_id AND req.ability_internal_name = a.internal_name AND req.locale = $2
    LEFT JOIN ability_localizations en ON en.dataset_version_id = a.dataset_version_id AND en.ability_internal_name = a.internal_name AND en.locale = 'en'`;
  return { values, conditions, localizationJoins };
}

async function resolveAbilitySliceRequest(
  filters: AbilityFilters,
  request: ListSliceRequest,
): Promise<ResolvedAbilitySliceRequest> {
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
  const filterIdentity = createListFilterIdentity(
    canonicalAbilityQuery(filters),
  );
  const encoded = request.after ?? request.before;
  if (encoded !== undefined) {
    const decoded = decodeListCursor(encoded);
    assertListCursorMatches(decoded, {
      entityKind: "abilities",
      locale: filters.lang,
      filterIdentity,
      catalogDatasetVersionId: request.catalogDatasetVersionId,
      assetDatasetVersionId: request.assetDatasetVersionId,
    });
    const cursor = decoded as AbilityListCursor;
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

function emptyAbilitySlice(
  meta: ActiveDatasetMeta,
): CatalogSlice<AbilityCardRow> {
  return {
    items: [],
    datasetVersionId: meta.datasetVersionId,
    assetDatasetVersionId: meta.assetDatasetVersionId,
    previousCursor: null,
    nextCursor: null,
    total: 0,
  };
}

function mapAbilityCardRow(row: AbilityCardQueryRow): AbilityCardRow {
  return {
    internalName: row.internal_name,
    displayName: row.display_name,
    fallbackName: row.fallback_name,
    catalogStatus: row.catalog_status,
    definitionKind: row.definition_kind,
    behavior: row.behavior,
    damageType: row.damage_type,
    isInnate: row.is_innate,
    isUltimate: row.is_ultimate,
    isPassive: row.is_passive,
    hasScepterUpgrade: row.has_scepter_upgrade,
    hasShardUpgrade: row.has_shard_upgrade,
    cooldown: row.cooldown,
    manaCost: row.mana_cost,
    textureName: row.texture_name,
    owners: row.owners,
  };
}

export async function getAbilityByInternalName(
  internalName: string,
  locale: "en" | "zh-CN",
): Promise<AbilityDetail | null> {
  const database = await ensureReady();
  const meta = await getActiveCatalogMeta();
  if (!meta) return null;
  const ability = await database.query<AbilityDetail["ability"]>(
    "SELECT * FROM abilities WHERE dataset_version_id = $1 AND internal_name = $2",
    [meta.datasetVersionId, internalName],
  );
  if (!ability.rowCount) return null;
  const [localizations, values, idMappings, bindings, sources] =
    await Promise.all([
      database.query<AbilityDetail["localizations"][number]>(
        "SELECT * FROM ability_localizations WHERE dataset_version_id = $1 AND ability_internal_name = $2 ORDER BY CASE WHEN locale = $3 THEN 0 WHEN locale = 'en' THEN 1 ELSE 2 END, locale",
        [meta.datasetVersionId, internalName, locale],
      ),
      database.query<AbilityDetail["values"][number]>(
        "SELECT value_key, ordinal, scalar_value, level_values, modifiers, raw_value FROM ability_values WHERE dataset_version_id = $1 AND ability_internal_name = $2 ORDER BY ordinal",
        [meta.datasetVersionId, internalName],
      ),
      database.query<AbilityDetail["idMappings"][number]>(
        "SELECT ability_id, source_path, source_line FROM ability_id_mappings WHERE dataset_version_id = $1 AND internal_name = $2 ORDER BY ability_id, source_line",
        [meta.datasetVersionId, internalName],
      ),
      database.query<AbilityDetail["bindings"][number]>(
        `SELECT b.hero_id, h.internal_name AS hero_internal_name, h.slug,
           COALESCE(req.display_name, en.display_name, h.internal_name) AS hero_name,
           b.relation_kind, b.source_slot, b.ordinal, b.is_current, b.source_path, b.source_line
         FROM hero_ability_bindings b
         JOIN heroes h ON h.dataset_version_id = b.dataset_version_id AND h.hero_id = b.hero_id
         LEFT JOIN hero_localizations req ON req.dataset_version_id = h.dataset_version_id AND req.hero_id = h.hero_id AND req.locale = $3
         LEFT JOIN hero_localizations en ON en.dataset_version_id = h.dataset_version_id AND en.hero_id = h.hero_id AND en.locale = 'en'
         WHERE b.dataset_version_id = $1 AND b.ability_internal_name = $2
         ORDER BY b.is_current DESC, b.hero_id, b.ordinal, b.relation_kind`,
        [meta.datasetVersionId, internalName, locale],
      ),
      database.query<AbilityDetail["sources"][number]>(
        `SELECT occurrence_ordinal, source_path, source_line, declaration_kind, raw_definition,
           resolved_definition, raw_sha256, resolved_sha256, unknown_fields
         FROM entity_source_records
         WHERE dataset_version_id = $1 AND entity_type = 'ability' AND entity_key = $2
         ORDER BY occurrence_ordinal`,
        [meta.datasetVersionId, internalName],
      ),
    ]);
  return {
    meta,
    ability: ability.rows[0],
    localizations: localizations.rows,
    values: values.rows,
    idMappings: idMappings.rows,
    bindings: bindings.rows,
    sources: sources.rows,
  };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}
