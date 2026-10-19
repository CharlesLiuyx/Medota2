import "server-only";
import type { KeyValuesObject } from "@/importers/keyvalues/parser";
const object = (root: KeyValuesObject | undefined, key: string) => {
  const value = root?.entries.findLast((e) => e.key === key)?.value;
  return typeof value === "object" ? value : undefined;
};
import { pinyin } from "pinyin-pro";
import { valueLabel } from "@/presentation/dota";
import { ResourceCache } from "@/lib/resource-cache";
import {
  adaptHeroStatuses,
  type StatusSource,
} from "@/importers/dota-vpk/hero-status-adapter";
import {
  normalizeStatusSearch,
  type HeroStatusCatalog,
  type StatusProvider,
} from "@/domain/hero-status-catalog";
import { getCatalogMeta } from "@/server/repositories/heroes";
import { getItemOverview } from "@/server/repositories/items";
import { readUnitSnapshot } from "@/server/repositories/units";
import { getGameLocalization } from "./game-localization";
import { getWebDatabase } from "@/server/db/client";
import { sourceFileRecord } from "./source-file-records";

const cache = new ResourceCache<HeroStatusCatalog>({
  entries: 2,
  bytes: 20 * 1024 * 1024,
});
export async function getHeroStatusCatalog(
  dataset: string,
): Promise<HeroStatusCatalog | null> {
  const meta = await getCatalogMeta(dataset);
  if (!meta || meta.datasetVersionId !== dataset) return null;
  return cache.get(`${dataset}:${meta.sourceCommit}`, async () => {
    const db = await getWebDatabase();
    const [zh, en, items, units, abilityRows, values, owners, files] =
      await Promise.all([
        getGameLocalization(dataset, meta.sourceCommit, "zh-CN"),
        getGameLocalization(dataset, meta.sourceCommit, "en"),
        getItemOverview(dataset),
        readUnitSnapshot(meta),
        db.query<{ id: string; max_level: number | null; paths: string[] }>(
          `SELECT a.internal_name AS id,a.max_level,ARRAY(SELECT DISTINCT r.source_path FROM entity_source_records r WHERE r.dataset_version_id=a.dataset_version_id AND r.entity_type='ability' AND r.entity_key=a.internal_name) AS paths FROM abilities a WHERE a.dataset_version_id=$1 AND a.definition_kind='ability' AND a.catalog_status NOT IN ('deprecated','template')`,
          [dataset],
        ),
        db.query<{
          id: string;
          field: string;
          scalar_value: string | null;
          level_values: string[];
        }>(
          `SELECT ability_internal_name AS id,value_key AS field,scalar_value,level_values FROM ability_values WHERE dataset_version_id=$1 ORDER BY ordinal`,
          [dataset],
        ),
        db.query<{
          ability: string;
          id: string;
          slug: string;
          name: string;
          en_name: string;
        }>(
          `SELECT DISTINCT b.ability_internal_name AS ability,h.internal_name AS id,h.slug,zh.display_name AS name,en.display_name AS en_name FROM hero_ability_bindings b JOIN heroes h ON h.dataset_version_id=b.dataset_version_id AND h.hero_id=b.hero_id LEFT JOIN hero_localizations zh ON zh.dataset_version_id=h.dataset_version_id AND zh.hero_id=h.hero_id AND zh.locale='zh-CN' LEFT JOIN hero_localizations en ON en.dataset_version_id=h.dataset_version_id AND en.hero_id=h.hero_id AND en.locale='en' WHERE b.dataset_version_id=$1 AND b.is_current AND h.enabled`,
          [dataset],
        ),
        Promise.all(
          [
            "resource/localization/abilities_schinese.txt",
            "resource/localization/abilities_english.txt",
          ].map((path) => sourceFileRecord(dataset, path)),
        ),
      ]);
    if (
      !Object.keys(zh).some((k) => k.startsWith("dota_tooltip_modifier_")) ||
      !Object.keys(en).some((k) => k.startsWith("dota_tooltip_modifier_"))
    )
      throw new Error("Pinned status localization unavailable");
    const providers = new Map<string, StatusProvider[]>();
    const add = (ability: string, provider: StatusProvider) => {
      const rows = providers.get(ability) ?? [];
      if (!rows.some((p) => p.id === provider.id)) rows.push(provider);
      providers.set(ability, rows);
    };
    for (const owner of owners.rows)
      add(owner.ability, {
        id: owner.id,
        kind: "hero",
        name: owner.name || owner.en_name || owner.id,
        enName: owner.en_name || owner.name || owner.id,
        href: `/heroes/${owner.slug}`,
      });
    for (const unit of units?.units ?? []) {
      if (["helper", "event"].includes(unit.category)) continue;
      const kind =
        unit.category === "building"
          ? "building"
          : ["neutral", "ancient", "boss"].includes(unit.category)
            ? "neutral"
            : "unit";
      for (const ability of unit.abilities)
        add(ability, {
          id: unit.internalName,
          kind,
          name: unit.zhName,
          enName: unit.enName,
          href: `/units/${unit.internalName}`,
        });
    }
    const byAbility = new Map<string, StatusSource["values"]>();
    for (const row of values.rows) {
      const rows = byAbility.get(row.id) ?? [];
      rows.push({
        field: row.field,
        values: row.level_values.length
          ? row.level_values
          : row.scalar_value === null
            ? []
            : [row.scalar_value],
        name: zh[`dota_tooltip_ability_${row.id}_${row.field}`] || row.field,
        enName: en[`dota_tooltip_ability_${row.id}_${row.field}`] || row.field,
      });
      byAbility.set(row.id, rows);
    }
    const sources: StatusSource[] = abilityRows.rows.map((row) => ({
      id: row.id,
      kind: "ability",
      name:
        zh[`dota_tooltip_ability_${row.id}`] ||
        en[`dota_tooltip_ability_${row.id}`] ||
        row.id,
      enName: en[`dota_tooltip_ability_${row.id}`] || row.id,
      maxLevel: row.max_level,
      paths: row.paths,
      providers: providers.get(row.id) ?? [],
      values: byAbility.get(row.id) ?? [],
    }));
    for (const item of items.snapshot?.items ?? []) {
      if (item.category === "recipe") continue;
      sources.push({
        id: item.internalName,
        kind: "item",
        name: item.zhName,
        enName: item.enName,
        maxLevel: 1,
        paths: ["scripts/npc/items.txt"],
        providers: [
          {
            id: item.internalName,
            kind: "item",
            name: item.zhName,
            enName: item.enName,
            href: `/items/${item.internalName}`,
          },
        ],
        values: (
          object(
            object(items.snapshot?.raw, item.internalName),
            "AbilityValues",
          )?.entries ?? []
        ).map((entry) => {
          const raw =
            typeof entry.value === "string"
              ? entry.value
              : entry.value.entries.find((e) => e.key === "value")?.value;
          const label = item.stats.find((v) => v.key === entry.key);
          return {
            field: entry.key,
            values: typeof raw === "string" ? raw.trim().split(/\s+/u) : [],
            name: label?.zh || entry.key,
            enName: label?.en || entry.key,
          };
        }),
      });
    }
    // Tower protection is an engine-provided aura, without an npc_abilities entry.
    // Its modifier is named in the pinned localization; tower providers are real
    // building definitions. No armor/regen magnitude is inferred from the name.
    const towers = (units?.units ?? []).filter(
      (u) => u.category === "building" && /_tower\d/u.test(u.internalName),
    );
    if (towers.length)
      sources.push({
        id: "tower_aura",
        paths: [
          "scripts/npc/npc_units.txt",
          "resource/localization/abilities_english.txt",
          "resource/localization/abilities_schinese.txt",
        ],
        kind: "building",
        name: "",
        enName: "",
        maxLevel: 1,
        values: [],
        providers: towers.map((u) => ({
          id: u.internalName,
          kind: "building",
          name: u.zhName,
          enName: u.enName,
          href: `/units/${u.internalName}`,
        })),
      });
    for (const source of sources)
      for (const parameter of source.values) {
        parameter.name =
          valueLabel(parameter.field, parameter.name, "zh-CN", zh) ||
          parameter.field;
        parameter.enName =
          valueLabel(parameter.field, parameter.enName, "en", en) ||
          parameter.field;
      }
    const statuses = adaptHeroStatuses(sources, zh, en, meta.sourceCommit);
    for (const status of statuses) {
      const names = [
        status.name,
        status.enName,
        status.provider!.name,
        status.provider!.enName,
        status.sourceAbility?.name,
        status.sourceAbility?.enName,
        status.sourceModifier,
      ].join(" ");
      const syllables = pinyin(names, {
        toneType: "none",
        type: "array",
        v: true,
      });
      status.searchText = normalizeStatusSearch(
        [names, syllables.join(""), syllables.map((s) => s[0]).join("")].join(
          " ",
        ),
      );
    }
    return {
      dataset,
      sourceCommit: meta.sourceCommit,
      abilityImageVersion: meta.assetDatasetVersionId,
      statuses,
      provenance: {
        source_repository: meta.sourceRepository,
        source_commit: meta.sourceCommit,
        source_path: [
          ...new Set(sources.flatMap((source) => source.paths ?? [])),
        ],
        client_version: meta.clientVersion,
        imported_at: new Date().toISOString(),
        importer_version: "hero-status-v1",
        schema_version: "hero-status-catalog-v1",
        localizations: files,
        units: units?.provenance ?? null,
        items: items.snapshot?.provenance ?? null,
      },
    };
  });
}
