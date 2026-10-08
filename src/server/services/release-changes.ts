import { attributePreview } from "@/presentation/entity-preview";
import { createTranslator } from "@/i18n/messages";
import { gameLocale } from "@/i18n/config";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locale";
import "server-only";
import patch741fEnglish from "@/data/patch-notes/7.41f.en.json";
import patch741f from "@/data/patch-notes/7.41f.json";
import type {
  EntityVersionSnapshot,
  EntityVersionChange,
} from "@/domain/entity-version-diff";
import { withRelease, type ReleaseOption } from "@/domain/releases";
import {
  displayName,
  gameText,
  numbers,
  labels,
  textValues,
  talentValues,
  valueLabel,
  tooltipValue,
  type ValueRow,
} from "@/presentation/dota";
import {
  matchesPatchBoundary,
  readableChanges,
  type ChangeDictionary,
  type ChangeIdentity,
  type ReadableChange,
} from "@/presentation/entity-changes";
import {
  UNIT_CATEGORIES,
  UNIT_STATS,
  type UnitDefinition,
} from "@/domain/units";
import { getUnitPortraits } from "@/server/repositories/units";
import { getItemOverview } from "@/server/repositories/items";
import { readEntityVersion } from "./entity-version-diff";
import { getGameLocalization } from "./game-localization";

export interface PatchNote {
  text: string;
  upgrade?: string;
  detail?: string;
  sourceUrl?: string;
  sourceLocale?: "zh-CN" | "en";
}
export interface ChangeSection {
  entity?: import("@/presentation/entity-preview").EntityPreview;
  key: string;
  name: string;
  href?: string;
  notes: PatchNote[];
  rows: ReadableChange[];
}
export interface ChangeGroup {
  entity?: import("@/presentation/entity-preview").EntityPreview;
  key: string;
  name: string;
  href?: string;
  kind: "hero" | "ability" | "item" | "unit" | "mechanism" | "other";
  sections: ChangeSection[];
}
function dictionary(
  snapshot: EntityVersionSnapshot,
  tokens: Record<string, string>,
  locale: Locale,
  assetVersion?: string,
  unitPortraits: Awaited<ReturnType<typeof getUnitPortraits>> = {},
): ChangeDictionary {
  const lang = gameLocale(locale);
  const t = createTranslator(locale);
  const names: ChangeDictionary = {
    heroes: {},
    heroIds: {},
    abilities: {},
    units: {},
  };
  const localizations = new Map(
    (snapshot.groups.localization?.entities ?? []).map((e) => [
      e.key,
      e.fields,
    ]),
  );
  for (const h of snapshot.groups.hero?.entities ?? []) {
    const loc = localizations.get(`hero:${h.fields.hero_id}:${lang}`);
    const identity = {
      key: h.key,
      name: displayName(
        loc?.display_name as string,
        undefined,
        undefined,
        locale,
      ),
      href: withRelease(`/heroes/${h.fields.slug}`, snapshot.version),
    };
    names.heroes[h.key] = {
      ...identity,
      preview: {
        ...identity,
        kind: "hero",
        icon: assetVersion
          ? `/valve-assets/hero/${h.key}?v=${assetVersion}`
          : undefined,
        description: [h.fields.primary_attribute, h.fields.attack_type]
          .filter(Boolean)
          .map((v) => t(labels[String(v)] ?? String(v)))
          .join(" · "),
        facts: [
          ["基础力量", "base_strength"],
          ["基础敏捷", "base_agility"],
          ["基础智力", "base_intelligence"],
          ["基础移动速度", "movement_speed"],
        ].map(([label, field]) => ({
          label: t(label),
          value: numbers(h.fields[field], locale),
          entity: attributePreview(
            "hero",
            h.key,
            field,
            t(label),
            t,
            undefined,
            snapshot.version,
          ),
        })),
      },
    };
    names.heroIds[String(h.fields.hero_id)] = h.key;
  }
  for (const u of snapshot.groups.unit?.entities ?? []) {
    const unit = u.fields as unknown as UnitDefinition;
    const name = lang === "en" ? unit.enName : unit.zhName;
    names.units![u.key] = {
      key: u.key,
      name,
      href: withRelease(`/units/${u.key}`, snapshot.version),
      preview: {
        key: u.key,
        name,
        kind: "unit",
        href: withRelease(`/units/${u.key}`, snapshot.version),
        icon:
          unitPortraits[u.key]?.resolution !== "unavailable" &&
          unitPortraits[u.key]
            ? `/valve-assets/unit/${u.key}?v=${unitPortraits[u.key].version}`
            : undefined,
        description: t(UNIT_CATEGORIES[unit.category]),
        facts: Object.entries(unit.stats)
          .filter(([, value]) => value !== null)
          .slice(0, 6)
          .map(([key, value]) => ({
            label: t(UNIT_STATS[key as keyof typeof UNIT_STATS] ?? key),
            value: value!,
            entity: attributePreview(
              "unit",
              u.key,
              key,
              t(UNIT_STATS[key as keyof typeof UNIT_STATS] ?? key),
              t,
              undefined,
              snapshot.version,
            ),
          })),
      },
    };
  }
  const allValues = (snapshot.groups.ability?.entities ?? []).flatMap(
    (a) => Object.values(a.fields.values ?? {}) as ValueRow[],
  );
  const talentRows = new Map<string, ValueRow[]>();
  for (const row of allValues)
    for (const mod of row.modifiers ?? [])
      if (mod.key.startsWith("special_bonus_")) {
        const rows = talentRows.get(mod.key) ?? [];
        rows.push(row);
        talentRows.set(mod.key, rows);
      }
  for (const a of snapshot.groups.ability?.entities ?? []) {
    const loc = localizations.get(`ability:${a.key}:${lang}`);
    const rows = Object.values(a.fields.values ?? {}) as ValueRow[];
    const values = textValues(
      [...rows, ...talentValues(a.key, talentRows.get(a.key) ?? [])],
      a.fields,
      locale,
    );
    const prefix = `dota_tooltip_ability_${a.key}`;
    const localized = tokens[prefix] || (loc?.display_name as string);
    const labels = Object.fromEntries(
      rows
        .map((row) => [
          row.value_key.toLowerCase(),
          tokens[`${prefix}_${row.value_key.toLowerCase()}`],
        ])
        .filter(([, v]) => v),
    );
    names.abilities[a.key] = {
      key: a.key,
      name: displayName(
        localized,
        a.key.startsWith("special_bonus_")
          ? t("天赋（名称待补充）")
          : t("技能（名称待补充）"),
        values,
        locale,
      ),
      preview: {
        key: a.key,
        name: displayName(localized, undefined, values, locale),
        kind: "ability",
        href: withRelease(`/abilities/${a.key}`, snapshot.version),
        icon: assetVersion
          ? `/valve-assets/ability/${a.key}?v=${assetVersion}`
          : undefined,
        description: gameText(loc?.description as string, values, locale),
        facts: [
          ...[
            ["冷却时间", "cooldown", "AbilityCooldown"],
            ["魔法消耗", "mana_cost", "AbilityManaCost"],
            ["施法距离", "cast_range", "AbilityCastRange"],
          ]
            .filter(
              ([, field]) =>
                a.fields[field] != null &&
                /[1-9]/u.test(String(a.fields[field])),
            )
            .map(([label, field, attributeField]) => ({
              label: t(label),
              value: numbers(a.fields[field], locale),
              entity: attributePreview(
                "ability",
                a.key,
                attributeField,
                t(label),
                t,
                undefined,
                snapshot.version,
              ),
            })),
          ...rows.flatMap((row) => {
            const localized = labels[row.value_key.toLowerCase()];
            const label = valueLabel(row.value_key, localized, locale, tokens);
            return label
              ? [
                  {
                    label,
                    entity: attributePreview(
                      "ability",
                      a.key,
                      row.value_key,
                      label,
                      t,
                      localized,
                      snapshot.version,
                    ),
                    value: tooltipValue(
                      numbers(row.scalar_value ?? row.level_values, locale),
                      row,
                      localized,
                      locale,
                    ),
                  },
                ]
              : [];
          }),
        ].slice(0, 6),
      },
      values,
      labels,
      valueRows: Object.fromEntries(rows.map((row) => [row.value_key, row])),
      href: withRelease(`/abilities/${a.key}`, snapshot.version),
    };
  }
  const bindings =
    snapshot.groups.relation?.entities.filter(
      (r) => r.key.startsWith("hero-ability:") && r.fields.is_current,
    ) ?? [];
  for (const heroKey of Object.values(names.heroIds)) {
    const heroId = Object.entries(names.heroIds).find(
      ([, k]) => k === heroKey,
    )![0];
    const owned = bindings.filter((b) => String(b.fields.hero_id) === heroId);
    const talents = owned
      .filter((b) => b.fields.relation_kind === "talent")
      .sort(
        (a, b) =>
          Number(String(a.fields.source_slot).replace("Ability", "")) -
          Number(String(b.fields.source_slot).replace("Ability", "")),
      );
    for (const b of owned) {
      const ability = names.abilities[String(b.fields.ability_internal_name)];
      if (!ability) continue;
      ability.heroKey ??= heroKey;
      const talent = talents.indexOf(b);
      if (talent >= 0) ability.talentLevel = 10 + 5 * Math.floor(talent / 2);
    }
  }
  return names;
}
export async function getReleaseChangesView(
  from: ReleaseOption,
  to: ReleaseOption,
  changes: EntityVersionChange[],
  locale: Locale = DEFAULT_LOCALE,
) {
  const lang = gameLocale(locale);
  const t = createTranslator(locale);
  const [
    before,
    after,
    beforeTokens,
    afterTokens,
    oldItems,
    newItems,
    oldPortraits,
    newPortraits,
  ] = await Promise.all([
    readEntityVersion(from.id),
    readEntityVersion(to.id),
    from.catalogId
      ? getGameLocalization(from.catalogId, from.sourceCommit, lang)
      : Promise.resolve<Record<string, string>>({}),
    to.catalogId
      ? getGameLocalization(to.catalogId, to.sourceCommit, lang)
      : Promise.resolve<Record<string, string>>({}),
    from.catalogId ? getItemOverview(from.catalogId) : null,
    to.catalogId ? getItemOverview(to.catalogId) : null,
    from.catalogId ? getUnitPortraits(from.catalogId) : {},
    to.catalogId ? getUnitPortraits(to.catalogId) : {},
  ]);
  const oldNames = dictionary(
      before,
      beforeTokens,
      locale,
      oldItems?.meta?.assetDatasetVersionId,
      oldPortraits,
    ),
    newNames = dictionary(
      after,
      afterTokens,
      locale,
      newItems?.meta?.assetDatasetVersionId,
      newPortraits,
    );
  for (const [dict, overview, release] of [
    [oldNames, oldItems, from],
    [newNames, newItems, to],
  ] as const) {
    for (const item of overview?.snapshot?.items ?? []) {
      const name = lang === "en" ? item.enName : item.zhName;
      dict.abilities[item.internalName] = {
        key: item.internalName,
        name,
        href: withRelease(`/items/${item.internalName}`, release.id),
        preview: {
          key: item.internalName,
          name,
          kind: "item",
          href: withRelease(`/items/${item.internalName}`, release.id),
          icon: overview?.imageVersion
            ? `/valve-assets/item/${item.internalName}?v=${overview.imageVersion}`
            : undefined,
          description:
            lang === "en" ? item.descriptions.en : item.descriptions.zh,
          facts: item.stats.slice(0, 6).map((stat) => ({
            label: lang === "en" ? stat.en : stat.zh,
            value: stat.value,
            entity: attributePreview(
              "item",
              item.internalName,
              stat.key,
              lang === "en" ? stat.en : stat.zh,
              t,
              stat.labelToken,
              release.id,
            ),
          })),
        },
      };
    }
  }
  const names: ChangeDictionary = {
    heroes: { ...oldNames.heroes, ...newNames.heroes },
    units: { ...oldNames.units, ...newNames.units },
    heroIds: { ...oldNames.heroIds, ...newNames.heroIds },
    abilities: { ...oldNames.abilities, ...newNames.abilities },
  };
  const editions = [patch741f];
  const sourcePatch =
    editions.find((edition) => matchesPatchBoundary(edition, from, to)) ?? null;
  const patch =
    sourcePatch && lang === "en"
      ? {
          ...sourcePatch,
          source: patch741fEnglish.source,
          heroes: patch741fEnglish.heroes.map((hero) => ({
            ...hero,
            abilities: hero.abilities.map((ability) => ({
              ...ability,
              name: names.abilities[ability.key]?.name ?? ability.key,
            })),
          })),
          items: patch741fEnglish.items.map((item) => ({
            ...item,
            name: displayName(
              afterTokens[`dota_tooltip_ability_${item.key}`] ||
                beforeTokens[`dota_tooltip_ability_${item.key}`],
              item.key,
              undefined,
              locale,
            ),
          })),
        }
      : sourcePatch;
  const measuredEdition =
    sourcePatch ??
    editions.find((edition) => matchesPatchBoundary(edition, to, from));
  const reversedItems = Boolean(measuredEdition && !patch);
  const itemChanges: EntityVersionChange[] = measuredEdition
    ? (measuredEdition.itemChanges as EntityVersionChange[]).map((change) =>
        reversedItems
          ? {
              ...change,
              before: change.after,
              after: change.before,
              beforeSources: change.afterSources,
              afterSources: change.beforeSources,
              operation:
                change.operation === "added"
                  ? "removed"
                  : change.operation === "removed"
                    ? "added"
                    : "modified",
            }
          : change,
      )
    : [];
  if (measuredEdition)
    for (const [key, fallback] of Object.entries(measuredEdition.itemNames)) {
      const baseKey = key.replace("item_recipe_", "item_");
      const name = displayName(
        afterTokens[`dota_tooltip_ability_${baseKey}`] ||
          beforeTokens[`dota_tooltip_ability_${baseKey}`] ||
          fallback,
      );
      names.abilities[key] = {
        ...names.abilities[key],
        key,
        name: key.startsWith("item_recipe_") ? t("{name}图纸", { name }) : name,
      };
    }
  const presented = readableChanges(
    [...changes, ...itemChanges],
    names,
    oldNames,
    locale,
  );
  const groups = new Map<string, ChangeGroup>();
  const section = (
    identity: ChangeIdentity,
    groupKey: string,
    kind: ChangeGroup["kind"],
  ): ChangeSection => {
    const owner =
      names.heroes[groupKey] ??
      names.abilities[groupKey] ??
      names.units?.[groupKey] ??
      identity;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        entity: owner.preview,
        name: owner.name,
        href: owner.href,
        kind,
        sections: [],
      };
      groups.set(groupKey, group);
    }
    let result = group.sections.find((s) => s.key === identity.key);
    if (!result) {
      result = {
        key: identity.key,
        entity: identity.preview,
        name:
          identity.key === groupKey && kind === "hero"
            ? t("基础属性")
            : identity.name,
        href: identity.href,
        notes: [],
        rows: [],
      };
      group.sections.push(result);
    }
    return result;
  };
  if (patch) {
    for (const hero of patch.heroes) {
      const key = names.heroIds[String(hero.heroId)];
      const identity = names.heroes[key] ?? {
        key: `official-hero:${hero.heroId}`,
        name: t("英雄（名称待补充）"),
      };
      if (hero.notes.length)
        section(identity, identity.key, "hero").notes = hero.notes;
      if (hero.talents.length)
        section(
          { key: `talents:${identity.key}`, name: t("天赋调整") },
          identity.key,
          "hero",
        ).notes = hero.talents;
      for (const ability of hero.abilities) {
        const skill = names.abilities[ability.key] ?? {
          key: ability.key,
          name: displayName(ability.name),
        };
        section(skill, identity.key, "hero").notes = ability.notes;
      }
    }
    for (const item of patch.items)
      section(
        names.abilities[item.key] ?? {
          key: item.key,
          name: displayName(item.name),
        },
        item.key,
        "item",
      ).notes = item.notes;
  }
  for (const row of presented.rows) {
    if (row.sourceLocale && row.sourceLocale !== lang) {
      presented.technical.push(...row.evidence);
      continue;
    }
    if (
      row.field === "ItemCost" &&
      row.subject.key.startsWith("item_recipe_")
    ) {
      const cost = Number(
        oldItems?.snapshot?.items.find(
          (item) =>
            item.internalName ===
            row.subject.key.replace("item_recipe_", "item_"),
        )?.cost,
      );
      row.scoreBaseline = Number.isFinite(cost) && cost > 0 ? cost : undefined;
    }
    const isHero = Boolean(names.heroes[row.subject.key]);
    const item = row.subject.key.startsWith("item_");
    const groupKey = item
      ? row.subject.key.replace("item_recipe_", "item_")
      : isHero
        ? row.subject.key
        : (row.subject.heroKey ?? row.subject.key);
    const talent = row.talent || row.subject.key.startsWith("special_bonus_");
    const identity =
      talent && names.heroes[groupKey]
        ? { key: `talents:${groupKey}`, name: t("天赋调整") }
        : row.subject;
    section(
      identity,
      groupKey,
      item
        ? "item"
        : isHero || row.subject.heroKey
          ? "hero"
          : row.kind === "unit"
            ? "unit"
            : "ability",
    ).rows.push(row);
  }
  if (patch?.fixes.length) {
    groups.set("official:fixes", {
      key: "official:fixes",
      name: t("问题修复"),
      kind: "other",
      entity: {
        key: "official:fixes",
        name: t("问题修复"),
        kind: "other",
        description: t("这些行为需要脚本或引擎验证，不能仅凭数值定义确认。"),
      },
      sections: [
        {
          key: "official:fixes",
          name: t("问题修复"),
          notes: patch.fixes.map((text) => ({
            text,
            sourceUrl: patch.fixesSource.url,
            sourceLocale: "zh-CN" as const,
          })),
          rows: [],
        },
      ],
    });
  }
  const referenceText = [...groups.values()]
    .flatMap((group) =>
      group.sections.flatMap((section) => [
        ...section.notes.map((note) => note.text),
        ...section.rows.flatMap((row) => [row.before, row.after]),
      ]),
    )
    .join("\n");
  const references = [
    ...Object.values(names.heroes).flatMap((identity) =>
      identity.preview ? [identity.preview] : [],
    ),
    ...[...groups.values()].flatMap((group) =>
      [
        group.entity,
        ...group.sections.flatMap((section) => [
          section.entity,
          ...section.rows.map((row) => row.subject.preview),
        ]),
      ].filter((entity): entity is NonNullable<typeof entity> =>
        Boolean(entity),
      ),
    ),
  ].filter(
    (entity, index, all) =>
      entity.name.length >= 2 &&
      referenceText.includes(entity.name) &&
      all.findIndex((candidate) => candidate.name === entity.name) === index,
  );
  return {
    references,
    groups: [...groups.values()],
    technical: presented.technical,
    patch,
    itemRecordCount: itemChanges.length,
  };
}
