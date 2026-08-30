import "server-only";

import { getWebPool } from "@/server/db/client";
import { assertSchemaCurrent } from "@/server/db/migrations";
import type { AbilityFilters } from "@/server/services/ability-filters";
import { getActiveCatalogMeta, type ActiveDatasetMeta } from "./heroes";

const PAGE_SIZE = 48;
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
  abilities: AbilityCardRow[];
  total: number;
  page: number;
  pageCount: number;
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

async function ensureReady(): Promise<void> {
  schemaPromise ??= assertSchemaCurrent(getWebPool());
  await schemaPromise;
}

export async function getAbilityOverview(
  filters: AbilityFilters | null,
): Promise<AbilityOverview> {
  await ensureReady();
  const meta = await getActiveCatalogMeta();
  if (!meta || !filters) {
    return { meta, abilities: [], total: 0, page: 1, pageCount: 0 };
  }
  const values: unknown[] = [meta.datasetVersionId, filters.lang];
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
  const joins = `LEFT JOIN ability_localizations req ON req.dataset_version_id = a.dataset_version_id AND req.ability_internal_name = a.internal_name AND req.locale = $2
    LEFT JOIN ability_localizations en ON en.dataset_version_id = a.dataset_version_id AND en.ability_internal_name = a.internal_name AND en.locale = 'en'`;
  const total = await getWebPool().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM abilities a ${joins} WHERE ${conditions.join(" AND ")}`,
    values,
  );
  const pageCount = Math.ceil(total.rows[0].count / PAGE_SIZE);
  const page = Math.min(filters.page, Math.max(1, pageCount));
  values.push(PAGE_SIZE, (page - 1) * PAGE_SIZE);
  const result = await getWebPool().query<{
    internal_name: string;
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
  }>(
    `SELECT a.internal_name, COALESCE(req.display_name, en.display_name, a.internal_name) AS display_name,
       CASE WHEN req.display_name IS NULL THEN en.display_name ELSE NULL END AS fallback_name,
       a.catalog_status, a.definition_kind, a.behavior, a.damage_type, a.is_innate,
       a.is_ultimate, a.is_passive, a.has_scepter_upgrade, a.has_shard_upgrade,
       a.cooldown, a.mana_cost, a.texture_name,
       COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
         'heroId', h.hero_id, 'slug', h.slug, 'internalName', h.internal_name,
         'displayName', COALESCE(hl_req.display_name, hl_en.display_name, h.internal_name),
         'relationKind', b.relation_kind)) FILTER (WHERE h.hero_id IS NOT NULL), '[]'::jsonb) AS owners
     FROM abilities a ${joins}
     LEFT JOIN hero_ability_bindings b ON b.dataset_version_id = a.dataset_version_id
       AND b.ability_internal_name = a.internal_name AND b.is_current
     LEFT JOIN heroes h ON h.dataset_version_id = b.dataset_version_id AND h.hero_id = b.hero_id
     LEFT JOIN hero_localizations hl_req ON hl_req.dataset_version_id = h.dataset_version_id AND hl_req.hero_id = h.hero_id AND hl_req.locale = $2
     LEFT JOIN hero_localizations hl_en ON hl_en.dataset_version_id = h.dataset_version_id AND hl_en.hero_id = h.hero_id AND hl_en.locale = 'en'
     WHERE ${conditions.join(" AND ")}
     GROUP BY a.dataset_version_id, a.internal_name, req.display_name, en.display_name
     ORDER BY COALESCE(req.display_name, en.display_name, a.internal_name), a.internal_name
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return {
    meta,
    total: total.rows[0].count,
    page,
    pageCount,
    abilities: result.rows.map((row) => ({
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
    })),
  };
}

export async function getAbilityByInternalName(
  internalName: string,
  locale: "en" | "zh-CN",
): Promise<AbilityDetail | null> {
  await ensureReady();
  const meta = await getActiveCatalogMeta();
  if (!meta) return null;
  const ability = await getWebPool().query<AbilityDetail["ability"]>(
    "SELECT * FROM abilities WHERE dataset_version_id = $1 AND internal_name = $2",
    [meta.datasetVersionId, internalName],
  );
  if (!ability.rowCount) return null;
  const [localizations, values, idMappings, bindings, sources] =
    await Promise.all([
      getWebPool().query<AbilityDetail["localizations"][number]>(
        "SELECT * FROM ability_localizations WHERE dataset_version_id = $1 AND ability_internal_name = $2 ORDER BY CASE WHEN locale = $3 THEN 0 WHEN locale = 'en' THEN 1 ELSE 2 END, locale",
        [meta.datasetVersionId, internalName, locale],
      ),
      getWebPool().query<AbilityDetail["values"][number]>(
        "SELECT value_key, ordinal, scalar_value, level_values, modifiers, raw_value FROM ability_values WHERE dataset_version_id = $1 AND ability_internal_name = $2 ORDER BY ordinal",
        [meta.datasetVersionId, internalName],
      ),
      getWebPool().query<AbilityDetail["idMappings"][number]>(
        "SELECT ability_id, source_path, source_line FROM ability_id_mappings WHERE dataset_version_id = $1 AND internal_name = $2 ORDER BY ability_id, source_line",
        [meta.datasetVersionId, internalName],
      ),
      getWebPool().query<AbilityDetail["bindings"][number]>(
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
      getWebPool().query<AbilityDetail["sources"][number]>(
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
