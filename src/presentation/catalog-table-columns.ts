import { HERO_ROLES } from "@/domain/heroes";
import type { AttributeEntry, AttributeOwnerKind } from "@/domain/attributes";
import type { AttributeEnumValue } from "@/domain/attribute-enums";

export interface CatalogAttributeColumn {
  key: string;
  attributeId: string;
  field: string;
  zh: string;
  en: string;
  ownerZh?: string;
  ownerEn?: string;
  enumValues?: AttributeEnumValue[];
}
export interface CatalogAttributeMatrix {
  columns: CatalogAttributeColumn[];
  values: Record<string, Record<string, string[]>>;
}
export interface CatalogAttributeResponse extends CatalogAttributeMatrix {
  version: 1;
  release: string;
  kind: AttributeOwnerKind;
  datasetVersionId: string;
}
export interface CatalogAttributeManifest {
  version: 2;
  release: string;
  kind: AttributeOwnerKind;
  datasetVersionId: string;
  resourceId: string;
  columns: CatalogAttributeColumn[];
}
export interface CatalogAttributeValues {
  version: 2;
  resourceId: string;
  loadedColumns: string[];
  values: CatalogAttributeMatrix["values"];
}
export const catalogAttributeColumnKey = (id: string, field: string) =>
  `attribute:${JSON.stringify([id, field])}`;

/** Preserve semantic identity and raw field; unrelated owner parameters never merge. */
export function buildCatalogAttributeMatrix(
  entries: readonly AttributeEntry[],
  kind: AttributeOwnerKind,
  selected?: ReadonlySet<string>,
): CatalogAttributeMatrix {
  const columns = new Map<string, CatalogAttributeColumn>();
  const values: CatalogAttributeMatrix["values"] = Object.create(null);
  for (const entry of entries) {
    for (const relation of entry.relations) {
      if (relation.kind !== kind) continue;
      const key = catalogAttributeColumnKey(entry.id, relation.field);
      if (!columns.has(key))
        columns.set(key, {
          key,
          attributeId: entry.id,
          field: relation.field,
          zh: /\p{Script=Han}/u.test(relation.labelZh)
            ? relation.labelZh
            : entry.zh,
          en:
            relation.labelEn && relation.labelEn !== relation.field
              ? relation.labelEn
              : `${entry.en} · ${relation.field}`,
          ...(entry.id.includes("~")
            ? { ownerZh: relation.zh, ownerEn: relation.en }
            : {}),
          ...(entry.enumValues ? { enumValues: entry.enumValues } : {}),
        });
      if (selected && !selected.has(key)) continue;
      const owner = (values[relation.owner] ??= Object.create(null));
      (owner[key] ??= []).push(relation.value);
    }
  }
  return { columns: [...columns.values()], values };
}

export const HERO_ROLE_TABLE_COLUMNS = HERO_ROLES.map((role) => `role:${role}`);

/** Preserve the reviewed overview, with individual role levels at the end. */
export const HERO_DEFAULT_TABLE_COLUMNS = [
  "entity",
  "category",
  "base_strength",
  catalogAttributeColumnKey("strength", "strength_gain"),
  "base_agility",
  catalogAttributeColumnKey("agility", "agility_gain"),
  "base_intelligence",
  catalogAttributeColumnKey("intelligence", "intelligence_gain"),
  "movement_speed",
  catalogAttributeColumnKey("armor", "base_armor"),
  catalogAttributeColumnKey("night-vision", "night_vision"),
  "complexity",
  catalogAttributeColumnKey("health-regen", "base_health_regen"),
  catalogAttributeColumnKey("attack-damage", "base_attack_damage_min"),
  catalogAttributeColumnKey("attack-damage", "base_attack_damage_max"),
  catalogAttributeColumnKey("attack-speed", "base_attack_speed"),
  catalogAttributeColumnKey("attack-interval", "attack_rate"),
  catalogAttributeColumnKey("attack-range", "attack_range"),
  ...HERO_ROLE_TABLE_COLUMNS,
];

export interface CatalogTablePreferences {
  columns: string[] | null;
  decimals: Record<string, number>;
  frozenThrough?: string | null;
}
export function parseCatalogTablePreferences(
  raw: string | null,
  kind?: AttributeOwnerKind,
): CatalogTablePreferences {
  const fallback = { columns: null, decimals: {} };
  if (raw === null) return fallback;
  try {
    const value = JSON.parse(raw);
    if (
      value?.version !== 1 ||
      (value.columns !== null &&
        (!Array.isArray(value.columns) ||
          !value.columns.every(
            (key: unknown) => typeof key === "string" && key.length <= 2048,
          )))
    )
      return fallback;
    const keys =
      value.columns === null
        ? null
        : [
            ...new Set<string>(
              value.columns.flatMap((key: string) =>
                kind === "hero" && key === "roles"
                  ? HERO_ROLE_TABLE_COLUMNS
                  : [key],
              ),
            ),
          ];
    if (keys && !keys.includes("entity")) keys.unshift("entity");
    const decimals = Object.fromEntries(
      Object.entries(value.decimals ?? {}).filter(
        ([key, digits]) =>
          key.length <= 2048 &&
          typeof digits === "number" &&
          Number.isInteger(digits) &&
          digits >= 0 &&
          digits <= 10,
      ),
    );
    return {
      columns: keys,
      decimals: decimals as Record<string, number>,
      ...(value.frozenThrough === null ||
      (typeof value.frozenThrough === "string" &&
        value.frozenThrough.length <= 2048)
        ? {
            frozenThrough:
              kind === "hero" && value.frozenThrough === "roles"
                ? HERO_ROLE_TABLE_COLUMNS.at(-1)
                : value.frozenThrough,
          }
        : {}),
    };
  } catch {
    return fallback;
  }
}
export function parseCatalogColumns(raw: string | null): string[] | null {
  return parseCatalogTablePreferences(raw).columns;
}
