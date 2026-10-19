"use client";
import { SourceText, useLocale } from "@/i18n/provider";
import { Message, useTranslations } from "@/i18n/provider";
import Link from "@/components/version-link";
import { AttributeLink } from "./attribute-link";
import { Fragment, useId, useState, type ReactNode } from "react";
import { heroAbilityLevel, requiredHeroLevel } from "@/domain/hero-abilities";
import { abilityMaxLevel } from "@/presentation/ability-levels";
import { abilityWithUpgrades } from "@/presentation/ability-upgrades";
import { abilityWithTalents } from "@/presentation/ability-talents";
import { useHeroAbilityBuild } from "./hero-build-provider";
import { AbilityIcon } from "@/components/ability-icon";
import {
  behaviorLabels,
  displayName,
  enumText,
  gameText,
  numbers,
  textValues,
  tooltipValue,
  valueLabel,
  type TooltipAbility,
} from "@/presentation/dota";
export function AbilityTooltip({
  ability: sourceAbility,
  tokens = {},
  assetVersion,
  heading = false,
  controls,
  adjustableLevel = false,
  id,
}: {
  ability: TooltipAbility;
  tokens?: Record<string, string>;
  assetVersion: string;
  lang?: string;
  heading?: boolean;
  controls?: ReactNode;
  adjustableLevel?: boolean;
  id?: string;
}) {
  const locale = useLocale();
  const t = useTranslations();
  const [selectedLevel, setSelectedLevel] = useState(1);
  const levelGroup = useId();
  const maxLevel = abilityMaxLevel(sourceAbility);
  const heroBuild = useHeroAbilityBuild();
  const rule = adjustableLevel
    ? heroBuild?.rules.find((rule) => rule.id === sourceAbility.internal_name)
    : undefined;
  const level =
    rule && heroBuild
      ? heroAbilityLevel(
          heroBuild.build,
          rule,
          heroBuild.rules,
          heroBuild.upgrades,
        )
      : Math.min(selectedLevel, maxLevel ?? 1);
  const selectLevel = (value: number) => {
    if (rule && heroBuild)
      heroBuild.dispatch({ type: "ability", id: rule.id, level: value });
    else setSelectedLevel(value);
  };
  const resetVersion = heroBuild?.resetVersion ?? 0;
  const [lastReset, setLastReset] = useState(resetVersion);
  if (lastReset !== resetVersion) {
    setLastReset(resetVersion);
    setSelectedLevel(1);
  }
  const upgrades = adjustableLevel
    ? (heroBuild?.upgrades ?? {
        scepter: false,
        shard: false,
      })
    : { scepter: false, shard: false };
  const upgradeProjection = abilityWithUpgrades(sourceAbility, upgrades);
  const projection = abilityWithTalents(
    upgradeProjection.ability,
    adjustableLevel ? (heroBuild?.selectedTalents ?? []) : [],
  );
  const ability = projection.ability;
  // Keep the whole comparison vector. The stats projection selects the active
  // rank separately; shared scalars remain a single value.
  const levelValues = (formatted: string, field?: string) => {
    if (!adjustableLevel || !/\d/u.test(formatted)) return formatted;
    const row = ability.values.find(
      (row) => row.value_key.toLowerCase() === field?.toLowerCase(),
    );
    const levelKey = row?.modifiers?.find(
      (modifier) => modifier.key === "levelkey",
    )?.value;
    const orb = (
      {
        quaslevel: "invoker_quas",
        wexlevel: "invoker_wex",
        exortlevel: "invoker_exort",
      } as Record<string, string>
    )[String(levelKey)];
    const valueRule = heroBuild?.rules.find((rule) => rule.id === orb);
    const valueLevel = levelKey
      ? valueRule && heroBuild
        ? heroAbilityLevel(
            heroBuild.build,
            valueRule,
            heroBuild.rules,
            heroBuild.upgrades,
          )
        : 0
      : level;
    const parts = formatted.split(" / ");
    const count =
      parts.length > 1
        ? Math.max(
            parts.length,
            levelKey ? (valueRule?.maxLevel ?? 1) : (maxLevel ?? 1),
          )
        : 1;
    return (
      <span
        className="inline-flex max-w-full flex-wrap justify-end gap-x-1 tabular-nums"
        data-level-values
      >
        {Array.from({ length: count }, (_, index) => {
          const active =
            adjustableLevel &&
            valueLevel > 0 &&
            (count === 1 || index + 1 === valueLevel);
          return (
            <span key={index} className="inline-flex gap-x-1">
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="font-normal text-[var(--text-muted)]"
                >
                  {" "}
                  /{" "}
                </span>
              )}
              <span
                data-value-level={index + 1}
                data-selected={active ? "true" : undefined}
                aria-current={active ? "true" : undefined}
                className={
                  active
                    ? "rounded-sm bg-[#e4c584]/15 px-1 font-bold text-[#f2d597]"
                    : "text-[var(--text-secondary)]"
                }
              >
                {parts[Math.min(index, parts.length - 1)]}
              </span>
            </span>
          );
        })}
      </span>
    );
  };
  const renderGameText = (
    input: string | null | undefined,
    values: Record<string, string>,
  ): ReactNode => {
    if (!adjustableLevel) return gameText(input, values, locale);
    const entries = Object.entries(values);
    const marked = Object.fromEntries(
      entries.map(([key], index) => [key, `\uE000${index}\uE001`]),
    );
    const text = gameText(input, marked, locale);
    if (!text) return null;
    return text.split(/(\uE000\d+\uE001)/u).map((part, index) => {
      const token = /^\uE000(\d+)\uE001$/u.exec(part);
      return (
        <Fragment key={index}>
          {token && entries[Number(token[1])]
            ? levelValues(
                entries[Number(token[1])][1],
                entries[Number(token[1])][0],
              )
            : part}
        </Fragment>
      );
    });
  };
  const talentNames = (ids: string[]) =>
    heroBuild?.talents
      .filter((talent) => ids.includes(talent.id))
      .map((talent) => talent.name)
      .join(" · ") ?? "";
  const prefix = `dota_tooltip_ability_${ability.internal_name}`;
  const vals = textValues(ability.values, ability, locale);
  const name = displayName(
    ability.display_name,
    ability.definition_kind === "talent"
      ? t("天赋名称待补充")
      : t("技能名称待补充"),
    vals,
    locale,
  );
  const description = renderGameText(ability.description, vals);
  const attributes = [
    [
      t("技能类型"),
      behaviorLabels(ability.behavior, locale).join("、") ||
        (ability.is_passive ? t("被动") : t("未提供")),
      "AbilityBehavior",
    ],
    [
      t("影响单位"),
      [
        enumText(ability.unit_target_team, locale),
        enumText(ability.unit_target_type, locale),
      ]
        .filter((v) => v !== t("未提供"))
        .join(" · "),
    ],
    [
      t("伤害类型"),
      ability.damage_type ? enumText(ability.damage_type, locale) : "",
      "AbilityUnitDamageType",
    ],
    [
      t("减益免疫"),
      ability.spell_immunity_type
        ? enumText(ability.spell_immunity_type, locale)
        : "",
      "SpellImmunityType",
    ],
    [
      t("驱散类型"),
      ability.spell_dispellable_type
        ? enumText(ability.spell_dispellable_type, locale)
        : "",
      "SpellDispellableType",
    ],
  ].filter(([, v]) => v && v !== t("未提供"));
  const rows = ability.values
    .map((v) => ({
      ...v,
      label: valueLabel(
        v.value_key,
        tokens[`${prefix}_${v.value_key}`.toLowerCase()],
        locale,
        tokens,
      ),
      formatted: numbers(
        v.level_values.length ? v.level_values : v.scalar_value,
        locale,
      ),
    }))
    .filter(
      (v) =>
        v.label &&
        v.formatted !== t("未提供") &&
        !(
          v.level_values.every((n) => Number(n) === 0) &&
          v.modifiers?.some((m) => m.key.startsWith("special_bonus_"))
        ),
    );
  const basic = [
    [t("施法距离"), ability.cast_range, "AbilityCastRange"],
    [t("施法前摇"), ability.cast_point, "AbilityCastPoint"],
    [t("持续施法"), ability.channel_time, "AbilityChannelTime"],
    [t("伤害"), ability.damage, "AbilityDamage"],
    [t("持续时间"), ability.duration, "AbilityDuration"],
    [t("生命消耗"), ability.health_cost, "AbilityHealthCost"],
    [t("充能次数"), ability.charges, "AbilityCharges"],
    [
      t("充能恢复时间"),
      ability.charge_restore_time,
      "AbilityChargeRestoreTime",
    ],
  ] as const;
  const notes = Object.entries(tokens)
    .filter(([key]) => new RegExp(`^${prefix}_note\\d+$`, "u").test(key))
    .map(([, v]) => renderGameText(v, vals));
  return (
    <article
      className="dota-tooltip"
      id={id ?? `skill-${ability.internal_name}`}
    >
      <div
        className={
          adjustableLevel
            ? "flex items-start justify-between gap-3 pb-3"
            : "flex items-center gap-4 pb-4"
        }
        data-ability-header
      >
        <div
          className={
            adjustableLevel
              ? "flex min-w-0 flex-1 items-center gap-3"
              : "contents"
          }
        >
          <AbilityIcon
            internalName={ability.internal_name}
            name={name}
            assetVersion={assetVersion}
            large={heading}
          />
          <div className="min-w-0">
            <p className="mb-1 text-xs tracking-widest text-[#cbb27c]">
              {ability.is_innate
                ? t("先天技能")
                : ability.is_ultimate
                  ? t("终极技能")
                  : ability.definition_kind === "talent"
                    ? t("英雄天赋")
                    : ability.is_passive
                      ? t("被动技能")
                      : t("主动技能")}
            </p>
            {heading ? (
              <h1 className="text-3xl font-semibold sm:text-4xl">
                <SourceText sourceLocale={ability.sourceLocales?.display_name}>
                  {name}
                </SourceText>
              </h1>
            ) : (
              <h3 className="text-xl font-semibold">
                <Link
                  className="hover:text-[#e4c584]"
                  href={`/abilities/${ability.internal_name}`}
                >
                  <SourceText
                    sourceLocale={ability.sourceLocales?.display_name}
                  >
                    {name}
                  </SourceText>
                </Link>
              </h3>
            )}
          </div>
        </div>
        {adjustableLevel && (
          <div
            className="flex min-w-0 max-w-[55%] flex-col items-end gap-1"
            data-ability-level-controls
          >
            {maxLevel ? (
              <>
                <div className="flex flex-wrap justify-end gap-x-2 text-[10px] text-[var(--text-muted)]">
                  <span aria-hidden="true">{t("当前等级")}</span>
                  <span>{t("最高等级 {level}", { level: maxLevel })}</span>
                </div>
                <fieldset
                  ref={(node) => {
                    if (node) node.dataset.interactiveReady = "true";
                  }}
                  role="radiogroup"
                  aria-label={t("当前等级")}
                  className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1"
                  disabled={
                    Boolean(rule?.fixed || rule?.dependentOn) ||
                    (maxLevel === 1 && (!rule || rule.freeLevel === 1))
                  }
                >
                  {[
                    ...(rule && rule.freeLevel === 0 ? [0] : []),
                    ...Array.from(
                      { length: maxLevel },
                      (_, index) => index + 1,
                    ),
                  ].map((rank) => (
                    <label key={rank} className="relative inline-flex">
                      <input
                        type="radio"
                        name={levelGroup}
                        value={rank}
                        checked={level === rank}
                        onChange={() => selectLevel(rank)}
                        disabled={
                          rule ? requiredHeroLevel(rule, rank) > 30 : false
                        }
                        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
                      />
                      <span className="inline-flex min-h-6 min-w-6 cursor-pointer items-center justify-center rounded-sm bg-white/5 px-1.5 text-xs tabular-nums text-[var(--text-secondary)] hover:bg-white/10 peer-checked:bg-[#e4c584]/20 peer-checked:font-semibold peer-checked:text-[#f2d597] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#e4c584] peer-disabled:cursor-default peer-disabled:opacity-50">
                        {rank === 0 ? t("未学习") : rank}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </>
            ) : (
              <span className="text-xs text-[var(--text-muted)]">
                {t("等级上限待确认")}
              </span>
            )}
          </div>
        )}
      </div>
      {adjustableLevel && rule && (
        <p
          className="mb-2 text-xs text-[var(--text-muted)]"
          data-ability-learning
        >
          {rule.dependentOn
            ? t("等级随关联技能同步。")
            : rule.fixed
              ? t("等级由技能解锁状态决定。")
              : t(
                  "选择高阶技能会同步提高英雄等级；降低英雄等级会调整技能与天赋。",
                )}
        </p>
      )}
      {adjustableLevel &&
        heroBuild?.appliedStats.includes(ability.internal_name) && (
          <p className="mb-2 text-xs text-[#e4c584]" data-ability-stats>
            {t("当前等级的常驻加成已计入英雄属性。")}
          </p>
        )}
      {projection.appliedTalentIds.length > 0 && (
        <p className="mb-2 text-xs text-[#e4c584]" data-applied-talents>
          {t("已计入天赋：{names}", {
            names: talentNames(projection.appliedTalentIds),
          })}
        </p>
      )}
      {projection.unresolvedTalentIds.length > 0 && (
        <p
          className="mb-2 text-xs text-[var(--text-muted)]"
          data-unresolved-talents
        >
          {t("天赋条件待解析，相关数值暂缺：{names}", {
            names: talentNames(projection.unresolvedTalentIds),
          })}
        </p>
      )}
      {adjustableLevel && upgradeProjection.required && (
        <p
          data-upgrade-unlock
          className={`mb-2 text-xs ${upgrades[upgradeProjection.required] ? "text-[#a5d3ff]" : "text-[var(--text-muted)]"}`}
        >
          {t(
            upgrades[upgradeProjection.required]
              ? "升级已解锁此技能"
              : "配置对应神杖／魔晶后解锁此技能",
          )}
        </p>
      )}
      {adjustableLevel &&
        (["scepter", "shard"] as const)
          .filter(
            (kind) =>
              upgrades[kind] &&
              (ability[`has_${kind}_upgrade`] ||
                ability[`is_granted_by_${kind}`] ||
                upgradeProjection.applied.includes(kind)),
          )
          .map((kind) => (
            <p
              key={kind}
              data-active-upgrade={kind}
              className="mb-2 text-xs text-[#a5d3ff]"
            >
              {t(kind === "scepter" ? "神杖效果已生效" : "魔晶效果已生效")}
            </p>
          ))}
      {upgradeProjection.unresolved.length > 0 && (
        <p className="mb-2 text-xs text-[var(--text-muted)]">
          {t("部分升级存在额外条件，相关数值暂缺，请参照升级说明。")}
        </p>
      )}
      {controls}
      <dl className="mt-4 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        {attributes.map(([label, value, field]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-[var(--text-muted)]">
              {field ? (
                <AttributeLink
                  kind="ability"
                  owner={ability.internal_name}
                  field={field}
                >
                  {label}
                </AttributeLink>
              ) : (
                label
              )}
            </dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="game-description mt-5">
        <SourceText sourceLocale={ability.sourceLocales?.description}>
          {description || t("此技能暂未提供效果说明。")}
        </SourceText>
      </p>
      <dl className="skill-values mt-5">
        {basic
          .filter(
            ([, v]) =>
              numbers(v, locale) !== t("未提供") &&
              String(v)
                .split(/\s+/u)
                .some((n) => Number(n) !== 0),
          )
          .map(([label, v, field]) => (
            <div key={label}>
              <dt>
                <AttributeLink
                  kind="ability"
                  owner={ability.internal_name}
                  field={field}
                >
                  {label}
                </AttributeLink>
              </dt>
              <dd>
                {levelValues(numbers(v, locale), field)}
                {[
                  t("施法前摇"),
                  t("持续施法"),
                  t("持续时间"),
                  t("充能恢复时间"),
                ].includes(label)
                  ? t(" 秒")
                  : ""}
              </dd>
            </div>
          ))}
        {rows.map((v) => (
          <div key={v.value_key} data-ability-value={v.value_key}>
            <dt>
              <AttributeLink
                kind="ability"
                owner={ability.internal_name}
                field={v.value_key}
                labelToken={tokens[`${prefix}_${v.value_key}`.toLowerCase()]}
              >
                {v.label}
              </AttributeLink>
            </dt>
            <dd>
              {levelValues(
                tooltipValue(
                  v.formatted,
                  v,
                  tokens[`${prefix}_${v.value_key}`.toLowerCase()],
                  locale,
                ),
                v.value_key,
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap gap-5 pt-4 text-sm">
        {ability.cooldown != null &&
          (Number(ability.cooldown) > 0 ||
            upgradeProjection.applied.length > 0 ||
            !ability.is_passive) && (
            <span className="text-[#d4dce1]">
              <AttributeLink
                kind="ability"
                owner={ability.internal_name}
                field="AbilityCooldown"
              >
                <Message
                  id="冷却 {value0} 秒"
                  values={{
                    value0: (
                      <strong>
                        {levelValues(
                          numbers(ability.cooldown, locale),
                          "AbilityCooldown",
                        )}
                      </strong>
                    ),
                  }}
                />
              </AttributeLink>
            </span>
          )}
        {ability.mana_cost != null && !ability.is_passive && (
          <span className="text-[#82bbf2]">
            <AttributeLink
              kind="ability"
              owner={ability.internal_name}
              field="AbilityManaCost"
            >
              <Message
                id="魔法消耗 {value0}"
                values={{
                  value0: (
                    <strong>
                      {levelValues(
                        numbers(ability.mana_cost, locale),
                        "AbilityManaCost",
                      )}
                    </strong>
                  ),
                }}
              />
            </AttributeLink>
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        {t("多组数值按技能等级从低到高排列。")}
      </p>
      {(["scepter", "shard"] as const).map((kind) => {
        const text = ability[`${kind}_description`] as string | null;
        const preview = abilityWithTalents(
          abilityWithUpgrades(sourceAbility, { ...upgrades, [kind]: true })
            .ability,
          adjustableLevel ? (heroBuild?.selectedTalents ?? []) : [],
        ).ability;
        const previewValues = textValues(preview.values, preview, locale);
        return ability.values.some((v) =>
          v.modifiers?.some((m) => m.key === `special_bonus_${kind}`),
        ) ||
          ability[`has_${kind}_upgrade`] ||
          ability[`is_granted_by_${kind}`] ? (
          <section className="aghanim mt-5" key={kind}>
            <h4>
              {kind === "scepter" ? t("阿哈利姆神杖") : t("阿哈利姆魔晶")} ·{" "}
              {ability[`is_granted_by_${kind}`]
                ? t("获得新技能")
                : t("技能升级")}
            </h4>
            <p className="game-description mt-2">
              <SourceText
                sourceLocale={ability.sourceLocales?.[`${kind}_description`]}
              >
                {renderGameText(text, {
                  ...vals,
                  ...previewValues,
                }) || t("该升级的效果说明暂未提供。")}
              </SourceText>
            </p>
            <dl className="skill-values mt-3">
              {ability.values
                .filter(
                  (v) =>
                    valueLabel(
                      v.value_key,
                      tokens[`${prefix}_${v.value_key}`.toLowerCase()],
                      locale,
                      tokens,
                    ) &&
                    v.modifiers?.some((m) => m.key === `special_bonus_${kind}`),
                )
                .map((v) => (
                  <div key={v.value_key} data-ability-value={v.value_key}>
                    <dt>
                      {valueLabel(
                        v.value_key,
                        tokens[`${prefix}_${v.value_key}`.toLowerCase()],
                        locale,
                        tokens,
                      )}
                    </dt>
                    <dd>
                      {levelValues(
                        tooltipValue(
                          previewValues[v.value_key.toLowerCase()],
                          v,
                          tokens[`${prefix}_${v.value_key}`.toLowerCase()],
                          locale,
                        ),
                        v.value_key,
                      )}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ) : null;
      })}
      {notes.length > 0 && (
        <section className="mt-5 text-xs text-[var(--text-secondary)]">
          <h4 className="mb-2 text-[#cbb27c]">{t("机制说明")}</h4>
          <ul className="list-disc space-y-2 pl-4">
            {notes.map((note, i) => (
              <li key={i} className="whitespace-pre-line">
                {note}
              </li>
            ))}
          </ul>
        </section>
      )}
      {ability.lore && (
        <p className="mt-5 pt-4 text-xs italic leading-6 text-[var(--text-muted)]">
          <SourceText sourceLocale={ability.sourceLocales?.lore}>
            {renderGameText(ability.lore, vals)}
          </SourceText>
        </p>
      )}
    </article>
  );
}
