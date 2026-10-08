import { enumAttributeFields } from "@/domain/attribute-enums";
import { officialAttributeLabels } from "@/domain/attribute-mechanics";
import {
  attributeFieldLabel,
  attributeFieldLabelProvenance,
} from "@/domain/attribute-field-labels";
import {
  attributeParameterLabel,
  attributeParameterProvenance,
  unresolvedAttributeParameter,
} from "@/domain/attribute-parameter-labels";
import "server-only";
import { cache } from "react";
import { getWebDatabase } from "@/server/db/client";
import { getCatalogMeta, type ActiveDatasetMeta } from "./heroes";
import { readItemSnapshot } from "./items";
import { readUnitSnapshot } from "./units";
import { getGameLocalization } from "@/server/services/game-localization";
import {
  attributeId,
  ATTRIBUTES,
  buildAttributeEntries,
  HERO_ATTRIBUTE_FIELDS,
  type AttributeRelation,
} from "@/domain/attributes";
import { UNIT_STATS } from "@/domain/units";
import {
  gameText,
  numbers,
  textValues,
  valueLabel,
  effectiveAbility,
  type TooltipAbility,
} from "@/presentation/dota";
import { pinyin } from "pinyin-pro";
import {
  numericAttributeFields,
  resolvedUnitAttributeFields,
} from "@/domain/attribute-fields";

const snapshots = new Map<
  string,
  Promise<Awaited<ReturnType<typeof buildSnapshot>>>
>();
export const getAttributeOverview = cache(async (dataset?: string) => {
  const meta = await getCatalogMeta(dataset);
  if (!meta) return { meta: null, snapshot: null };
  const key = `${meta.datasetVersionId}:${meta.sourceCommit}`;
  let pending = snapshots.get(key);
  if (!pending) {
    pending = buildSnapshot(meta);
    if (snapshots.size >= 2) snapshots.delete(snapshots.keys().next().value!);
    snapshots.set(key, pending);
    void pending.then(
      (value) => {
        if (value.missing.length) snapshots.delete(key);
      },
      () => snapshots.delete(key),
    );
  }
  return { meta, snapshot: await pending };
});
async function buildSnapshot(meta: ActiveDatasetMeta) {
  const db = await getWebDatabase();
  const [items, units, zh, en, heroes, abilities] = await Promise.all([
    readItemSnapshot(meta),
    readUnitSnapshot(meta),
    getGameLocalization(meta.datasetVersionId, meta.sourceCommit, "zh-CN"),
    getGameLocalization(meta.datasetVersionId, meta.sourceCommit, "en"),
    db.query<Record<string, unknown>>(
      `SELECT h.*, sr.source_path, sr.source_line, sr.resolved_definition AS source_definition, z.display_name AS zh, e.display_name AS en FROM heroes h LEFT JOIN entity_source_records sr ON sr.dataset_version_id=h.dataset_version_id AND sr.entity_type='hero' AND sr.entity_key=h.internal_name AND sr.occurrence_ordinal=0 LEFT JOIN hero_localizations z ON z.dataset_version_id=h.dataset_version_id AND z.hero_id=h.hero_id AND z.locale='zh-CN' LEFT JOIN hero_localizations e ON e.dataset_version_id=h.dataset_version_id AND e.hero_id=h.hero_id AND e.locale='en' WHERE h.dataset_version_id=$1`,
      [meta.datasetVersionId],
    ),
    db.query<
      TooltipAbility & {
        zh: string;
        en: string;
        description_zh: string;
        description_en: string;
        source_path: string;
        source_line: number;
      }
    >(
      `SELECT a.*, z.display_name AS zh, e.display_name AS en, z.description AS description_zh, e.description AS description_en,
      s.source_path, s.source_line, s.resolved_definition AS source_definition,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('value_key',v.value_key,'scalar_value',v.scalar_value,'level_values',v.level_values,'modifiers',v.modifiers) ORDER BY v.ordinal) FROM ability_values v WHERE v.dataset_version_id=a.dataset_version_id AND v.ability_internal_name=a.internal_name),'[]'::jsonb) AS values
      FROM abilities a LEFT JOIN ability_localizations z ON z.dataset_version_id=a.dataset_version_id AND z.ability_internal_name=a.internal_name AND z.locale='zh-CN' LEFT JOIN ability_localizations e ON e.dataset_version_id=a.dataset_version_id AND e.ability_internal_name=a.internal_name AND e.locale='en'
      LEFT JOIN LATERAL (SELECT source_path,source_line,resolved_definition FROM entity_source_records WHERE dataset_version_id=a.dataset_version_id AND entity_type='ability' AND entity_key=a.internal_name ORDER BY occurrence_ordinal DESC LIMIT 1) s ON true WHERE a.dataset_version_id=$1`,
      [meta.datasetVersionId],
    ),
  ]);
  const relations: AttributeRelation[] = [];
  for (const item of items?.items ?? [])
    for (const stat of item.stats)
      relations.push({
        attributeId: attributeId(
          "item",
          item.internalName,
          stat.key,
          stat.labelToken,
        ),
        kind: "item",
        owner: item.internalName,
        href: `/items/${item.internalName}`,
        zh: item.zhName,
        en: item.enName,
        field: stat.key,
        labelZh: stat.zh,
        labelEn: stat.en,
        labelNote: stat.labelNote,
        value: stat.value,
        descriptionZh: item.descriptions.zh,
        descriptionEn: item.descriptions.en,
        sourcePath: "scripts/npc/items.txt",
        sourceLine: stat.sourceLine,
        modifiers: stat.modifiers,
      });
  for (const unit of units?.units ?? [])
    for (const [field, value] of Object.entries(unit.stats))
      if (value !== null)
        relations.push({
          attributeId: attributeId("unit", unit.internalName, field),
          kind: "unit",
          owner: unit.internalName,
          href: `/units/${unit.internalName}`,
          zh: unit.zhName,
          en: unit.enName,
          field,
          labelZh: UNIT_STATS[field as keyof typeof UNIT_STATS] ?? field,
          labelEn: field,
          value,
          descriptionZh: "",
          descriptionEn: "",
          sourcePath: "scripts/npc/npc_units.txt",
        });
  for (const hero of heroes.rows)
    for (const field of Object.keys(HERO_ATTRIBUTE_FIELDS))
      if (hero[field] !== null && hero[field] !== undefined)
        relations.push({
          attributeId: attributeId("hero", String(hero.internal_name), field),
          kind: "hero",
          owner: String(hero.internal_name),
          href: `/heroes/${hero.slug}`,
          zh: String(hero.zh ?? hero.en ?? "名称待补充"),
          en: String(hero.en ?? hero.zh ?? "Name unavailable"),
          field,
          labelZh: field,
          labelEn: field,
          value: String(hero[field]),
          descriptionZh: "",
          descriptionEn: "",
          sourcePath: String(hero.source_path || "scripts/npc/npc_heroes.txt"),
          sourceLine: hero.source_line ? Number(hero.source_line) : undefined,
        });
  for (const raw of abilities.rows) {
    const ability = effectiveAbility(raw),
      owner = ability.internal_name,
      token = `dota_tooltip_ability_${owner}`;
    const values = [...ability.values];
    for (const [field, key] of Object.entries({
      cooldown: "AbilityCooldown",
      mana_cost: "AbilityManaCost",
      cast_range: "AbilityCastRange",
      cast_point: "AbilityCastPoint",
      channel_time: "AbilityChannelTime",
      damage: "AbilityDamage",
      duration: "AbilityDuration",
      health_cost: "AbilityHealthCost",
      charges: "AbilityCharges",
      charge_restore_time: "AbilityChargeRestoreTime",
    })) {
      if (
        ability[field] != null &&
        !values.some((v) => v.value_key.toLowerCase() === key.toLowerCase())
      )
        values.push({
          value_key: key,
          scalar_value: String(ability[field]),
          level_values: [],
          modifiers: [],
        });
    }
    const descriptionZh = gameText(
      zh[`${token}_description`] || ability.description_zh,
      textValues(ability.values, ability, "zh-CN"),
      "zh-CN",
    );
    const descriptionEn = gameText(
      en[`${token}_description`] || ability.description_en,
      textValues(ability.values, ability, "en"),
      "en",
    );
    for (const value of values) {
      const supplement = attributeParameterLabel(
        meta.sourceCommit,
        owner,
        value.value_key,
      );
      const review =
        supplement ??
        unresolvedAttributeParameter(meta.sourceCommit, owner, value.value_key);
      relations.push({
        attributeId: attributeId(
          "ability",
          owner,
          value.value_key,
          zh[`${token}_${value.value_key}`.toLowerCase()] ||
            en[`${token}_${value.value_key}`.toLowerCase()],
        ),
        kind: "ability",
        owner,
        href: `/abilities/${owner}`,
        zh: zh[token] || ability.zh || ability.en || "名称待补充",
        en: en[token] || ability.en || ability.zh || "Name unavailable",
        field: value.value_key,
        labelZh:
          valueLabel(
            value.value_key,
            zh[`${token}_${value.value_key}`.toLowerCase()],
            "zh-CN",
            zh,
          ) ||
          supplement?.zh ||
          "未命名参数",
        labelEn:
          valueLabel(
            value.value_key,
            en[`${token}_${value.value_key}`.toLowerCase()],
            "en",
            en,
          ) ||
          supplement?.en ||
          "Unnamed parameter",
        labelNote: review?.note,
        value: numbers(
          value.level_values.length ? value.level_values : value.scalar_value,
        ),
        descriptionZh,
        descriptionEn,
        sourcePath:
          review?.definition.sourcePath ||
          ability.source_path ||
          "scripts/npc/npc_abilities.txt",
        sourceLine: review?.definition.line || ability.source_line,
        modifiers: value.modifiers,
      });
    }
  }
  const ownerRelations = new Map<string, AttributeRelation[]>();
  for (const relation of relations) {
    const key = `${relation.kind}:${relation.owner}`;
    const rows = ownerRelations.get(key) ?? [];
    rows.push(relation);
    ownerRelations.set(key, rows);
  }
  const addSourceFields = (
    kind: AttributeRelation["kind"],
    owner: string,
    href: string,
    nameZh: string,
    nameEn: string,
    source: unknown,
    sourcePath: string,
    descriptionZh = "",
    descriptionEn = "",
  ) => {
    const existing = ownerRelations.get(`${kind}:${owner}`) ?? [];
    const seen = new Set(existing.map((r) => r.field.toLowerCase()));
    for (const field of [
      ...numericAttributeFields(source),
      ...enumAttributeFields(source),
    ]) {
      const id = attributeId(kind, owner, field.key);
      // Normalized hero columns already preserve the corresponding source values.
      if (
        seen.has(field.key.toLowerCase()) ||
        existing.some(
          (r) =>
            r.field.toLowerCase() === field.key.toLowerCase() ||
            (kind === "hero" &&
              !id.includes("~") &&
              r.attributeId === id &&
              r.value === numbers(field.value)),
        )
      )
        continue;
      seen.add(field.key.toLowerCase());
      relations.push({
        attributeId: id,
        valueType:
          "excluded" in field
            ? "number"
            : field.value.includes("|")
              ? "flags"
              : "enum",
        kind,
        owner,
        href,
        zh: nameZh,
        en: nameEn,
        field: field.key,
        labelZh: field.key,
        labelEn: field.key,
        value: "excluded" in field ? numbers(field.value) : field.value,
        descriptionZh,
        descriptionEn,
        sourcePath,
        sourceLine: field.line,
      });
    }
  };
  for (const hero of heroes.rows)
    addSourceFields(
      "hero",
      String(hero.internal_name),
      `/heroes/${hero.slug}`,
      String(hero.zh ?? hero.en ?? "名称待补充"),
      String(hero.en ?? hero.zh ?? "Name unavailable"),
      hero.source_definition,
      String(hero.source_path || "scripts/npc/npc_heroes.txt"),
    );
  if (units) {
    const resolved = resolvedUnitAttributeFields(units.raw);
    for (const unit of units.units)
      addSourceFields(
        "unit",
        unit.internalName,
        `/units/${unit.internalName}`,
        unit.zhName,
        unit.enName,
        resolved.get(unit.internalName),
        "scripts/npc/npc_units.txt",
      );
  }
  for (const item of items?.items ?? [])
    addSourceFields(
      "item",
      item.internalName,
      `/items/${item.internalName}`,
      item.zhName,
      item.enName,
      items?.raw.entries.find((e) => e.key === item.internalName)?.value,
      "scripts/npc/items.txt",
      item.descriptions.zh,
      item.descriptions.en,
    );
  for (const ability of abilities.rows)
    addSourceFields(
      "ability",
      ability.internal_name,
      `/abilities/${ability.internal_name}`,
      zh[`dota_tooltip_ability_${ability.internal_name}`] ||
        ability.zh ||
        ability.en ||
        "名称待补充",
      en[`dota_tooltip_ability_${ability.internal_name}`] ||
        ability.en ||
        ability.zh ||
        "Name unavailable",
      ability.source_definition,
      ability.source_path || "scripts/npc/npc_abilities.txt",
      gameText(
        ability.description_zh,
        textValues(ability.values, ability, "zh-CN"),
        "zh-CN",
      ),
      gameText(
        ability.description_en,
        textValues(ability.values, ability, "en"),
        "en",
      ),
    );
  for (const relation of relations) {
    if (/\p{Script=Han}/u.test(relation.labelZh)) continue;
    const label = attributeFieldLabel(
      meta.sourceCommit,
      relation.kind,
      relation.owner,
      relation.field,
    );
    if (label) {
      relation.labelZh = label.zh;
      relation.labelNote = label.note;
    }
  }
  const entries = buildAttributeEntries(relations, ATTRIBUTES).map((entry) => {
    const labels = officialAttributeLabels(meta.sourceCommit, entry.id);
    return { ...entry, zh: labels.zh ?? entry.zh, en: labels.en ?? entry.en };
  });
  return {
    entries,
    missing: [...(!items ? ["物品"] : []), ...(!units ? ["单位"] : [])],
    provenance: {
      source_repository: meta.sourceRepository,
      source_commit: meta.sourceCommit,
      client_version: meta.clientVersion,
      imported_at: new Date().toISOString(),
      importer_version: "attributes-v4",
      schema_version: "attribute-read-model-v4",
      parameter_labels: attributeParameterProvenance(meta.sourceCommit),
      field_labels: attributeFieldLabelProvenance(meta.sourceCommit),
      items: items?.provenance,
      units: units?.provenance,
    },
    summaries: entries.map(({ relations, ...entry }) => {
      const names = [...new Set(relations.map((r) => `${r.zh} ${r.en}`))].join(
        " ",
      );
      const syllables = pinyin(entry.zh, {
        toneType: "none",
        type: "array",
        v: true,
      });
      return {
        id: entry.id,
        zh: entry.zh,
        en: entry.en,
        summary: entry.id.includes("~") ? "" : entry.summary,
        count: relations.length,
        owner: entry.id.includes("~") ? names : "",
        kinds: [...new Set(relations.map((r) => r.kind))],
        searchText: [
          entry.id,
          ...(entry.enumValues ?? []).map((v) => `${v.value} ${v.zh} ${v.en}`),
          entry.zh,
          entry.en,
          names,
          syllables.join(""),
          syllables.map((s) => s[0]).join(""),
        ].join(" "),
      };
    }),
  };
}
