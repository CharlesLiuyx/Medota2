"use client";
import { SourceText, useLocale } from "@/i18n/provider";
import { Message, useTranslations } from "@/i18n/provider";
import Link from "@/components/version-link";
import { AttributeLink } from "./attribute-link";
import type { ReactNode } from "react";
import { AbilityIcon } from "@/components/ability-icon";
import {
  effectiveAbility,
  upgradedValues,
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
  id,
}: {
  ability: TooltipAbility;
  tokens?: Record<string, string>;
  assetVersion: string;
  lang?: string;
  heading?: boolean;
  controls?: ReactNode;
  id?: string;
}) {
  const locale = useLocale();
  const t = useTranslations();
  const ability = effectiveAbility(sourceAbility);
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
  const description = gameText(ability.description, vals, locale);
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
    .map(([, v]) => gameText(v, vals, locale));
  return (
    <article
      className="dota-tooltip"
      id={id ?? `skill-${ability.internal_name}`}
    >
      <div className="flex items-center gap-4 pb-4">
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
                <SourceText sourceLocale={ability.sourceLocales?.display_name}>
                  {name}
                </SourceText>
              </Link>
            </h3>
          )}
        </div>
      </div>
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
                {numbers(v, locale)}
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
          <div key={v.value_key}>
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
              {tooltipValue(
                v.formatted,
                v,
                tokens[`${prefix}_${v.value_key}`.toLowerCase()],
                locale,
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap gap-5 pt-4 text-sm">
        {ability.cooldown != null && !ability.is_passive && (
          <span className="text-[#d4dce1]">
            <AttributeLink
              kind="ability"
              owner={ability.internal_name}
              field="AbilityCooldown"
            >
              <Message
                id="◷ 冷却 {value0} 秒"
                values={{
                  value0: <strong>{numbers(ability.cooldown, locale)}</strong>,
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
                id="◆ 魔法消耗 {value0}"
                values={{
                  value0: <strong>{numbers(ability.mana_cost, locale)}</strong>,
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
                {gameText(
                  text,
                  {
                    ...vals,
                    ...upgradedValues(ability.values, kind, locale),
                  },
                  locale,
                ) || t("该升级的效果说明暂未提供。")}
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
                  <div key={v.value_key}>
                    <dt>
                      {valueLabel(
                        v.value_key,
                        tokens[`${prefix}_${v.value_key}`.toLowerCase()],
                        locale,
                        tokens,
                      )}
                    </dt>
                    <dd>
                      {tooltipValue(
                        upgradedValues(ability.values, kind, locale)[
                          v.value_key.toLowerCase()
                        ],
                        v,
                        tokens[`${prefix}_${v.value_key}`.toLowerCase()],
                        locale,
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
            {gameText(ability.lore, vals, locale)}
          </SourceText>
        </p>
      )}
    </article>
  );
}
