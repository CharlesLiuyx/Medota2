"use client";

import type { ReactNode } from "react";
import { attributeId } from "@/domain/attributes";
import { catalogAttributeColumnKey } from "@/presentation/catalog-table-columns";
import {
  catalogNumericValue,
  formatCatalogNumberText,
  type CatalogSortValue,
} from "@/presentation/catalog-table";
import type { HeroCardRow } from "@/server/repositories/heroes";
import type { AbilityCardRow } from "@/server/repositories/abilities";
import {
  UNIT_CATEGORIES,
  UNIT_STATS,
  type UnitDefinition,
} from "@/domain/units";
import { ITEM_CATEGORIES, type ItemDefinition } from "@/domain/items";
import {
  labels,
  numbers,
  displayName,
  behaviorLabels,
} from "@/presentation/dota";
import { unitVariant } from "@/presentation/map-labels";
import type { Locale } from "@/i18n/locale";
import type { Translator } from "@/i18n/messages";
import type { CatalogTableEntry } from "./entity-catalog-table";
import type { UnitPortraitRef } from "./unit-portrait";
import { SourceText } from "@/i18n/provider";
import { AttributeLink } from "./attribute-link";
import { EntityReference } from "./entity-reference";

function row(
  key: string,
  label: string,
  value: ReactNode,
  sortValue: CatalogSortValue = typeof value === "string" ||
  typeof value === "number"
    ? value
    : null,
) {
  return { key, label, value, sortValue };
}
function stat(
  kind: "hero" | "ability" | "unit" | "item",
  owner: string,
  key: string,
  label: string,
  value: string | null,
  labelToken?: string,
) {
  return {
    renderValue: (decimals?: number) =>
      value === null ? (
        "—"
      ) : (
        <AttributeLink
          kind={kind}
          owner={owner}
          field={key}
          labelToken={labelToken}
          label={label}
          icon={false}
          value={value}
        >
          {formatCatalogNumberText(value, decimals)}
        </AttributeLink>
      ),
    attributeKey: catalogAttributeColumnKey(
      attributeId(kind, owner, key, labelToken),
      key,
    ),
    ...row(
      key,
      label,
      value === null ? (
        "—"
      ) : (
        <AttributeLink
          kind={kind}
          owner={owner}
          field={key}
          labelToken={labelToken}
          label={label}
          icon={false}
        >
          {value ?? "—"}
        </AttributeLink>
      ),
      catalogNumericValue(value),
    ),
  };
}
const asset = (kind: string, key: string, version: string) =>
  `/valve-assets/${kind}/${key}?v=${encodeURIComponent(version)}`;

export function heroTableEntry(
  hero: HeroCardRow,
  version: string,
  locale: Locale,
  en: boolean,
  t: Translator,
): CatalogTableEntry {
  const category = t(labels[hero.primaryAttribute]);
  const rows = [
    row("attack", t("攻击类型"), t(labels[hero.attackType])),
    row(
      "roles",
      t("角色"),
      hero.roles
        .map(({ role, level }) => `${t(labels[role] ?? role)} ${level}`)
        .join(" · ") || "—",
    ),
    stat(
      "hero",
      hero.internalName,
      "base_strength",
      t("力量"),
      numbers(hero.baseStrength, locale),
    ),
    stat(
      "hero",
      hero.internalName,
      "base_agility",
      t("敏捷"),
      numbers(hero.baseAgility, locale),
    ),
    stat(
      "hero",
      hero.internalName,
      "base_intelligence",
      t("智力"),
      numbers(hero.baseIntelligence, locale),
    ),
    stat(
      "hero",
      hero.internalName,
      "movement_speed",
      t("移动速度"),
      numbers(hero.movementSpeed, locale),
    ),
    row("complexity", t("操作难度"), `${hero.complexity} / 3`, hero.complexity),
  ];
  return {
    category,
    fields: rows,
    entity: {
      kind: "hero",
      key: hero.internalName,
      name: displayName(
        en ? hero.enName : hero.zhName,
        t("英雄名称待补充"),
        undefined,
        locale,
      ),
      href: `/heroes/${hero.slug}`,
      icon: asset("hero", hero.internalName, version),
      description: `${category} · ${t(labels[hero.attackType])}`,
      facts: [
        { label: t("力量"), value: numbers(hero.baseStrength, locale) },
        { label: t("敏捷"), value: numbers(hero.baseAgility, locale) },
        { label: t("智力"), value: numbers(hero.baseIntelligence, locale) },
        { label: t("移动速度"), value: numbers(hero.movementSpeed, locale) },
      ],
    },
  };
}

export function abilityTableEntry(
  ability: AbilityCardRow,
  version: string,
  locale: Locale,
  t: Translator,
): CatalogTableEntry {
  const category = t(
    ability.definitionKind === "talent"
      ? "天赋"
      : ability.isInnate
        ? "先天"
        : ability.isUltimate
          ? "终极"
          : ability.isPassive
            ? "被动"
            : "主动",
  );
  const description =
    ability.description ||
    (ability.definitionKind === "talent"
      ? ability.displayName
      : t("效果说明待补充"));
  const rows = [
    row(
      "owners",
      t("所属英雄"),
      ability.owners.length ? (
        <span className="flex flex-wrap gap-2">
          {ability.owners.map((owner) => (
            <EntityReference
              key={`${owner.internalName}:${owner.relationKind}`}
              entity={{
                kind: "hero",
                key: owner.internalName,
                name: owner.displayName,
                href: `/heroes/${owner.slug}`,
                icon: asset("hero", owner.internalName, version),
              }}
              inline
            />
          ))}
        </span>
      ) : (
        t("通用技能")
      ),
      ability.owners.map((owner) => owner.displayName).join(" · ") ||
        t("通用技能"),
    ),
    row("description", t("效果说明"), description),
    row(
      "behavior",
      t("施法方式"),
      behaviorLabels(ability.behavior, locale).join(" · ") || t("未提供"),
    ),
  ];
  if (!ability.isPassive && ability.definitionKind !== "talent") {
    rows.push(
      stat(
        "ability",
        ability.internalName,
        "AbilityCooldown",
        t("冷却时间"),
        ability.cooldown === null ? null : numbers(ability.cooldown, locale),
      ),
    );
    rows.push(
      stat(
        "ability",
        ability.internalName,
        "AbilityManaCost",
        t("魔法消耗"),
        ability.manaCost === null ? null : numbers(ability.manaCost, locale),
      ),
    );
  }
  if (ability.hasScepterUpgrade || ability.hasShardUpgrade)
    rows.push(
      row(
        "upgrades",
        t("升级"),
        [
          ability.hasScepterUpgrade ? t("神杖升级") : "",
          ability.hasShardUpgrade ? t("魔晶升级") : "",
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
  return {
    category,
    fields: rows,
    entity: {
      kind: "ability",
      key: ability.internalName,
      name: displayName(ability.displayName, undefined, undefined, locale),
      href: `/abilities/${ability.internalName}`,
      icon: asset("ability", ability.internalName, version),
      description,
    },
  };
}

export function unitTableEntry(
  unit: UnitDefinition & { portrait?: UnitPortraitRef },
  locale: Locale,
  en: boolean,
  t: Translator,
): CatalogTableEntry {
  const category = t(UNIT_CATEGORIES[unit.category]);
  const rows = [
    row("team", t("阵营"), t(unit.team)),
    row("attack", t("攻击类型"), t(unit.attack)),
  ];
  if (unit.variant)
    rows.push(row("variant", t("变体"), unitVariant(unit.variant, locale)));
  if (unit.portrait?.resolution === "related_icon")
    rows.push(
      row(
        "portrait",
        t("头像"),
        t(
          unit.portrait.relation === "unit_minimap"
            ? "小地图图标"
            : "关联技能图标",
        ),
      ),
    );
  rows.push(
    ...Object.entries(UNIT_STATS).map(([key, label]) =>
      stat("unit", unit.internalName, key, t(label), unit.stats[key] ?? null),
    ),
  );
  return {
    category,
    fields: rows,
    entity: {
      kind: "unit",
      key: unit.internalName,
      name: en ? unit.enName : unit.zhName,
      href: `/units/${unit.internalName}`,
      icon:
        unit.portrait && unit.portrait.resolution !== "unavailable"
          ? asset("unit", unit.internalName, unit.portrait.version)
          : undefined,
      description: `${category} · ${t(unit.team)} · ${t(unit.attack)}`,
      facts: Object.entries(UNIT_STATS)
        .slice(0, 4)
        .map(([key, label]) => ({
          label: t(label),
          value: unit.stats[key] ?? t("待确认"),
        })),
    },
  };
}

export function itemTableEntry(
  item: ItemDefinition,
  version: string | null,
  en: boolean,
  t: Translator,
): CatalogTableEntry {
  const category = t(ITEM_CATEGORIES[item.category]);
  const description =
    (en ? item.descriptions.en : item.descriptions.zh) || t("效果说明待补充");
  const rows = [
    row(
      "ItemCost",
      t("价格"),
      item.cost === null
        ? t("价格未提供")
        : t("{value0} 金币", { value0: item.cost }),
      catalogNumericValue(item.cost),
    ),
    row(
      "description",
      t("效果说明"),
      <SourceText sourceLocale={item.descriptionLocales?.[en ? "en" : "zh"]}>
        {description}
      </SourceText>,
      description,
    ),
    ...item.stats.map((value, index) => ({
      ...stat(
        "item",
        item.internalName,
        value.key,
        t(en ? value.en : value.zh),
        t(value.value),
        value.labelToken,
      ),
      key: `stat:${value.key}:${value.zh}:${value.en}:${item.stats.slice(0, index).filter((prior) => prior.key === value.key).length}`,
    })),
  ];
  return {
    category,
    fields: rows,
    entity: {
      kind: "item",
      key: item.internalName,
      name: en ? item.enName : item.zhName,
      href: `/items/${item.internalName}`,
      icon: version ? asset("item", item.internalName, version) : undefined,
      description,
      facts: [
        {
          label: t("价格"),
          value:
            item.cost === null
              ? t("价格未提供")
              : t("{value0} 金币", { value0: item.cost }),
        },
      ],
    },
  };
}
