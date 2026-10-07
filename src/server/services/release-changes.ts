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
  textValues,
  talentValues,
  type ValueRow,
} from "@/presentation/dota";
import {
  matchesPatchBoundary,
  readableChanges,
  type ChangeDictionary,
  type ChangeIdentity,
  type ReadableChange,
} from "@/presentation/entity-changes";
import { readEntityVersion } from "./entity-version-diff";
import { getGameLocalization } from "./game-localization";

export interface PatchNote {
  text: string;
  upgrade?: string;
  detail?: string;
}
export interface ChangeSection {
  key: string;
  name: string;
  href?: string;
  notes: PatchNote[];
  rows: ReadableChange[];
}
export interface ChangeGroup {
  key: string;
  name: string;
  href?: string;
  kind: "hero" | "ability" | "item";
  sections: ChangeSection[];
}
function dictionary(
  snapshot: EntityVersionSnapshot,
  tokens: Record<string, string>,
  locale: Locale,
): ChangeDictionary {
  const lang = gameLocale(locale);
  const t = createTranslator(locale);
  const names: ChangeDictionary = { heroes: {}, heroIds: {}, abilities: {} };
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
    names.heroes[h.key] = identity;
    names.heroIds[String(h.fields.hero_id)] = h.key;
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
  const [before, after, beforeTokens, afterTokens] = await Promise.all([
    readEntityVersion(from.id),
    readEntityVersion(to.id),
    from.catalogId
      ? getGameLocalization(from.catalogId, from.sourceCommit, lang)
      : Promise.resolve<Record<string, string>>({}),
    to.catalogId
      ? getGameLocalization(to.catalogId, to.sourceCommit, lang)
      : Promise.resolve<Record<string, string>>({}),
  ]);
  const oldNames = dictionary(before, beforeTokens, locale),
    newNames = dictionary(after, afterTokens, locale);
  const names: ChangeDictionary = {
    heroes: { ...oldNames.heroes, ...newNames.heroes },
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
      names.heroes[groupKey] ?? names.abilities[groupKey] ?? identity;
    let group = groups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
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
        { key: item.key, name: displayName(item.name) },
        item.key,
        "item",
      ).notes = item.notes;
  }
  for (const row of presented.rows) {
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
      item ? "item" : isHero || row.subject.heroKey ? "hero" : "ability",
    ).rows.push(row);
  }
  return {
    groups: [...groups.values()],
    technical: presented.technical,
    patch,
    itemRecordCount: itemChanges.length,
  };
}
