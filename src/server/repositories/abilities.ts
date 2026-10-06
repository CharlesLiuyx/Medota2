import "server-only";
import { cache } from "react";
import { searchCatalogAbilities } from "@/server/services/catalog-search";
import { getGameLocalization } from "@/server/services/game-localization";
import {
  displayName,
  gameText,
  textValues,
  talentValues,
  effectiveAbility,
  type ValueRow,
} from "@/presentation/dota";

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
  sortName?: string;
  displayName: string;
  description?: string;
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
    talentLevel?: number | null;
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

export function getAbilityCatalogSlice(
  filters: AbilityFilters,
  request: ListSliceRequest = {},
) {
  return readAbilityCatalogSlice(filters, request, CATALOG_SLICE_LIMIT);
}

/** Complete read for the versioned browser replica; the public cursor API stays bounded. */
export async function getAbilityReplicaRows(
  filters: AbilityFilters,
  request: ListSliceRequest,
) {
  const slice = await readAbilityCatalogSlice(filters, request, 20_000);
  if (slice.nextCursor || slice.total !== slice.items.length)
    throw new Error("Catalog exceeds the browser replica limit.");
  return slice.items;
}

async function readAbilityCatalogSlice(
  filters: AbilityFilters,
  request: ListSliceRequest,
  limit: number,
): Promise<CatalogSlice<AbilityCardRow>> {
  const database = await ensureReady();
  const resolved = await resolveAbilitySliceRequest(filters, request);
  const tokens = await getGameLocalization(
    resolved.catalogDatasetVersionId,
    null,
    filters.lang,
  );
  const extraMatches = filters.q
    ? await searchCatalogAbilities(resolved.catalogDatasetVersionId, filters.q)
    : [];
  const query = buildAbilityFilterQuery(
    filters,
    resolved.catalogDatasetVersionId,
    extraMatches,
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
  query.values.push(limit + 1);
  const limitIndex = query.values.length;
  const order = resolved.direction === "before" ? "DESC" : "ASC";

  const rowsPromise = database.query<AbilityCardQueryRow>(
    `WITH talent_slots AS (
       SELECT hero_id, source_slot,
         dense_rank() OVER (PARTITION BY hero_id ORDER BY ordinal) AS position
       FROM hero_ability_bindings
       WHERE dataset_version_id = $1 AND is_current AND relation_kind = 'talent'
     ), selected AS (
       SELECT a.internal_name, ${ABILITY_SORT_NAME_SQL} AS localized_sort_name
       FROM abilities a ${query.localizationJoins}
       WHERE ${query.conditions.join(" AND ")}
       ORDER BY ${ABILITY_SORT_NAME_SQL} COLLATE "C" ${order}, a.internal_name COLLATE "C" ${order}
       LIMIT $${limitIndex}
     )
     SELECT a.internal_name, selected.localized_sort_name,
       COALESCE(req.display_name, en.display_name, a.internal_name) AS display_name,
       CASE WHEN req.display_name IS NULL THEN en.display_name ELSE NULL END AS fallback_name,
       COALESCE(req.description, en.description) AS description,
       a.catalog_status, a.definition_kind, a.behavior, a.damage_type, a.is_innate,
       a.is_ultimate, a.is_passive, a.has_scepter_upgrade, a.has_shard_upgrade,
       a.cooldown, a.mana_cost, a.texture_name,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('value_key', av.value_key, 'level_values', av.level_values, 'scalar_value', av.scalar_value, 'modifiers', av.modifiers)) FROM ability_values av WHERE av.dataset_version_id = a.dataset_version_id AND av.ability_internal_name = a.internal_name), '[]'::jsonb) AS presentation_values,
       COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
         'heroId', h.hero_id, 'slug', h.slug, 'internalName', h.internal_name,
         'displayName', COALESCE(hl_req.display_name, hl_en.display_name, h.internal_name),
         'relationKind', b.relation_kind,
         'talentLevel', CASE WHEN ts.position BETWEEN 1 AND 8
           THEN 10 + ((ts.position - 1) / 2)::int * 5 ELSE NULL END
         )) FILTER (WHERE h.hero_id IS NOT NULL), '[]'::jsonb) AS owners
     FROM selected
     JOIN abilities a ON a.dataset_version_id = $1 AND a.internal_name = selected.internal_name
     LEFT JOIN ability_localizations req ON req.dataset_version_id = a.dataset_version_id
       AND req.ability_internal_name = a.internal_name AND req.locale = $2
     LEFT JOIN ability_localizations en ON en.dataset_version_id = a.dataset_version_id
       AND en.ability_internal_name = a.internal_name AND en.locale = 'en'
     LEFT JOIN hero_ability_bindings b ON b.dataset_version_id = a.dataset_version_id
       AND b.ability_internal_name = a.internal_name AND b.is_current
     LEFT JOIN heroes h ON h.dataset_version_id = b.dataset_version_id AND h.hero_id = b.hero_id
     LEFT JOIN talent_slots ts ON ts.hero_id = b.hero_id AND ts.source_slot = b.source_slot
       AND b.relation_kind = 'talent'
     LEFT JOIN hero_localizations hl_req ON hl_req.dataset_version_id = h.dataset_version_id
       AND hl_req.hero_id = h.hero_id AND hl_req.locale = $2
     LEFT JOIN hero_localizations hl_en ON hl_en.dataset_version_id = h.dataset_version_id
       AND hl_en.hero_id = h.hero_id AND hl_en.locale = 'en'
     GROUP BY a.dataset_version_id, a.internal_name, selected.localized_sort_name,
       req.display_name, en.display_name, req.description, en.description
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
  const hasMore = result.rows.length > limit;
  let selectedRows = result.rows.slice(0, limit);
  if (resolved.direction === "before") selectedRows = selectedRows.reverse();

  const talentNames = selectedRows
    .filter((row) => row.definition_kind === "talent")
    .map((row) => row.internal_name);
  if (talentNames.length) {
    const linked = await database.query<ValueRow>(
      `SELECT value_key, level_values, scalar_value, modifiers FROM ability_values WHERE dataset_version_id = $1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(modifiers) m WHERE m->>'key' = ANY($2::text[]))`,
      [resolved.catalogDatasetVersionId, talentNames],
    );
    for (const row of selectedRows)
      if (row.definition_kind === "talent")
        row.presentation_values.push(
          ...talentValues(row.internal_name, linked.rows),
        );
  }
  for (const row of selectedRows) {
    row.description =
      tokens[`dota_tooltip_ability_${row.internal_name}_description`] ||
      row.description;
    const label = tokens[`dota_tooltip_ability_${row.internal_name}`];
    if (label) {
      row.display_name = label;
      row.fallback_name = null;
    }
  }
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
  description: string | null;
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
  presentation_values: ValueRow[];
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
  extraMatches: string[],
): AbilityFilterQuery {
  const values: unknown[] = [catalogDatasetVersionId, filters.lang];
  const conditions = ["a.dataset_version_id = $1"];
  if (filters.status !== "all") {
    values.push(filters.status);
    conditions.push(`a.catalog_status = $${values.length}`);
  }
  if (filters.q) {
    values.push(extraMatches);
    conditions.push(`a.internal_name = ANY($${values.length}::text[])`);
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
  const resolved = effectiveAbility({
    ...row,
    values: row.presentation_values,
  });
  return {
    internalName: row.internal_name,
    sortName: row.localized_sort_name,
    displayName: displayName(
      row.display_name,
      "技能名称待补充",
      textValues(row.presentation_values),
    ),
    description: gameText(
      row.description,
      textValues(row.presentation_values, resolved),
    ),
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
    cooldown: resolved.cooldown,
    manaCost: resolved.mana_cost,
    textureName: row.texture_name,
    owners: [...row.owners].sort((a, b) => {
      const left = `${a.slug}:${a.relationKind}`,
        right = `${b.slug}:${b.relationKind}`;
      return left < right ? -1 : left > right ? 1 : 0;
    }),
  };
}

export const getAbilityByInternalName = cache(
  async function getAbilityByInternalName(
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
    if (ability.rows[0].definition_kind === "talent") {
      const linked = await database.query<ValueRow>(
        `SELECT value_key, level_values, scalar_value, modifiers FROM ability_values WHERE dataset_version_id = $1 AND EXISTS (SELECT 1 FROM jsonb_array_elements(modifiers) m WHERE m->>'key' = $2)`,
        [meta.datasetVersionId, internalName],
      );
      for (const value of talentValues(internalName, linked.rows))
        values.rows.push({
          ...value,
          ordinal: values.rows.length,
          scalar_value: null,
          modifiers: [],
          raw_value: null,
        });
    }
    await Promise.all(
      localizations.rows.map(async (row) => {
        const tokens = await getGameLocalization(
          meta.datasetVersionId,
          meta.sourceCommit,
          row.locale,
        );
        Object.assign(row, localizedAbilityFields(internalName, tokens, row));
      }),
    );
    return {
      meta,
      ability: ability.rows[0],
      localizations: localizations.rows,
      values: values.rows,
      idMappings: idMappings.rows,
      bindings: bindings.rows,
      sources: sources.rows,
    };
  },
);

/** One batched read for the hero's tooltips, preserving the selected catalog. */
export async function getHeroSpellbook(
  dataset: string,
  heroId: number,
  locale: string,
  sourceCommit: string | null = null,
) {
  const database = await ensureReady();
  const result = await database.query<
    import("@/presentation/dota").TooltipAbility & {
      relation_kind: string;
      source_slot: string;
      ordinal: number;
    }
  >(
    `
    SELECT a.*, b.relation_kind, b.source_slot, b.ordinal,
      (SELECT s.resolved_definition FROM entity_source_records s WHERE s.dataset_version_id=a.dataset_version_id AND s.entity_type='ability' AND s.entity_key=a.internal_name ORDER BY s.occurrence_ordinal DESC LIMIT 1) AS source_definition,
      COALESCE(l.display_name, en.display_name) AS display_name,
      COALESCE(l.description, en.description) AS description,
      COALESCE(l.lore, en.lore) AS lore,
      COALESCE(l.scepter_description, en.scepter_description) AS scepter_description,
      COALESCE(l.shard_description, en.shard_description) AS shard_description,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('value_key', v.value_key, 'level_values', v.level_values, 'scalar_value', v.scalar_value, 'modifiers', v.modifiers) ORDER BY v.ordinal)
        FROM ability_values v WHERE v.dataset_version_id = a.dataset_version_id AND v.ability_internal_name = a.internal_name), '[]'::jsonb) AS values
    FROM hero_ability_bindings b JOIN abilities a ON a.dataset_version_id = b.dataset_version_id AND a.internal_name = b.ability_internal_name
    LEFT JOIN ability_localizations l ON l.dataset_version_id = a.dataset_version_id AND l.ability_internal_name = a.internal_name AND l.locale = $3
    LEFT JOIN ability_localizations en ON en.dataset_version_id = a.dataset_version_id AND en.ability_internal_name = a.internal_name AND en.locale = 'en'
    WHERE b.dataset_version_id = $1 AND b.hero_id = $2 AND b.is_current
    ORDER BY b.ordinal, b.relation_kind`,
    [dataset, heroId, locale],
  );
  const tokens = await getGameLocalization(dataset, sourceCommit, locale);
  for (const row of result.rows)
    Object.assign(row, localizedAbilityFields(row.internal_name, tokens, row));
  const allValues = result.rows.flatMap((a) => a.values);
  return result.rows.map((a) =>
    a.definition_kind === "talent"
      ? {
          ...a,
          values: [...a.values, ...talentValues(a.internal_name, allValues)],
        }
      : a,
  );
}

function localizedAbilityFields(
  name: string,
  tokens: Record<string, string>,
  stored: {
    display_name: string | null;
    description: string | null;
    lore?: string | null;
    scepter_description?: string | null;
    shard_description?: string | null;
  },
) {
  const prefix = `dota_tooltip_ability_${name}`;
  return {
    display_name: tokens[prefix] || stored.display_name,
    description: tokens[`${prefix}_description`] || stored.description,
    lore: tokens[`${prefix}_lore`] || stored.lore,
    scepter_description:
      tokens[`${prefix}_scepter_description`] || stored.scepter_description,
    shard_description:
      tokens[`${prefix}_shard_description`] || stored.shard_description,
  };
}
