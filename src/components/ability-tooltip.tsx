import Link from "next/link";
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
  lang = "zh-CN",
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
  const ability = effectiveAbility(sourceAbility);
  const prefix = `dota_tooltip_ability_${ability.internal_name}`;
  const vals = textValues(ability.values, ability);
  const name = displayName(
    ability.display_name,
    ability.definition_kind === "talent" ? "天赋名称待补充" : "技能名称待补充",
    vals,
  );
  const description = gameText(ability.description, vals);
  const attributes = [
    [
      "技能类型",
      behaviorLabels(ability.behavior).join("、") ||
        (ability.is_passive ? "被动" : "未提供"),
    ],
    [
      "影响单位",
      [enumText(ability.unit_target_team), enumText(ability.unit_target_type)]
        .filter((v) => v !== "未提供")
        .join(" · "),
    ],
    ["伤害类型", ability.damage_type ? enumText(ability.damage_type) : ""],
    [
      "减益免疫",
      ability.spell_immunity_type ? enumText(ability.spell_immunity_type) : "",
    ],
    [
      "驱散方式",
      ability.spell_dispellable_type
        ? enumText(ability.spell_dispellable_type)
        : "",
    ],
  ].filter(([, v]) => v && v !== "未提供");
  const rows = ability.values
    .map((v) => ({
      ...v,
      label: valueLabel(
        v.value_key,
        tokens[`${prefix}_${v.value_key}`.toLowerCase()],
      ),
      formatted: numbers(
        v.level_values.length ? v.level_values : v.scalar_value,
      ),
    }))
    .filter(
      (v) =>
        v.label &&
        v.formatted !== "未提供" &&
        !(
          v.level_values.every((n) => Number(n) === 0) &&
          v.modifiers?.some((m) => m.key.startsWith("special_bonus_"))
        ),
    );
  const basic = [
    ["施法距离", ability.cast_range],
    ["施法前摇", ability.cast_point],
    ["持续施法", ability.channel_time],
    ["伤害", ability.damage],
    ["持续时间", ability.duration],
    ["生命消耗", ability.health_cost],
    ["充能次数", ability.charges],
    ["充能恢复时间", ability.charge_restore_time],
  ] as const;
  const notes = Object.entries(tokens)
    .filter(([key]) => new RegExp(`^${prefix}_note\\d+$`, "u").test(key))
    .map(([, v]) => gameText(v, vals));
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
              ? "先天技能"
              : ability.is_ultimate
                ? "终极技能"
                : ability.definition_kind === "talent"
                  ? "英雄天赋"
                  : ability.is_passive
                    ? "被动技能"
                    : "主动技能"}
          </p>
          {heading ? (
            <h1 className="text-3xl font-semibold sm:text-4xl">{name}</h1>
          ) : (
            <h3 className="text-xl font-semibold">
              <Link
                className="hover:text-[#e4c584]"
                href={`/abilities/${ability.internal_name}${lang === "en" ? "?lang=en" : ""}`}
              >
                {name}
              </Link>
            </h3>
          )}
        </div>
      </div>
      {controls}
      <dl className="mt-4 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
        {attributes.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <dt className="text-[var(--text-muted)]">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="game-description mt-5">
        {description || "此技能暂未提供效果说明。"}
      </p>
      <dl className="skill-values mt-5">
        {basic
          .filter(
            ([, v]) =>
              numbers(v) !== "未提供" &&
              String(v)
                .split(/\s+/u)
                .some((n) => Number(n) !== 0),
          )
          .map(([label, v]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {numbers(v)}
                {["施法前摇", "持续施法", "持续时间", "充能恢复时间"].includes(
                  label,
                )
                  ? " 秒"
                  : ""}
              </dd>
            </div>
          ))}
        {rows.map((v) => (
          <div key={v.value_key}>
            <dt>{v.label}</dt>
            <dd>
              {tooltipValue(
                v.formatted,
                v,
                tokens[`${prefix}_${v.value_key}`.toLowerCase()],
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap gap-5 pt-4 text-sm">
        {ability.cooldown != null && !ability.is_passive && (
          <span className="text-[#d4dce1]">
            ◷ 冷却 <strong>{numbers(ability.cooldown)}</strong> 秒
          </span>
        )}
        {ability.mana_cost != null && !ability.is_passive && (
          <span className="text-[#82bbf2]">
            ◆ 魔法消耗 <strong>{numbers(ability.mana_cost)}</strong>
          </span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-muted)]">
        多组数值按技能等级从低到高排列。
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
              {kind === "scepter" ? "阿哈利姆神杖" : "阿哈利姆魔晶"} ·{" "}
              {ability[`is_granted_by_${kind}`] ? "获得新技能" : "技能升级"}
            </h4>
            <p className="game-description mt-2">
              {gameText(text, {
                ...vals,
                ...upgradedValues(ability.values, kind),
              }) || "该升级的效果说明暂未提供。"}
            </p>
            <dl className="skill-values mt-3">
              {ability.values
                .filter(
                  (v) =>
                    valueLabel(
                      v.value_key,
                      tokens[`${prefix}_${v.value_key}`.toLowerCase()],
                    ) &&
                    v.modifiers?.some((m) => m.key === `special_bonus_${kind}`),
                )
                .map((v) => (
                  <div key={v.value_key}>
                    <dt>
                      {valueLabel(
                        v.value_key,
                        tokens[`${prefix}_${v.value_key}`.toLowerCase()],
                      )}
                    </dt>
                    <dd>
                      {tooltipValue(
                        upgradedValues(ability.values, kind)[
                          v.value_key.toLowerCase()
                        ],
                        v,
                        tokens[`${prefix}_${v.value_key}`.toLowerCase()],
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
          <h4 className="mb-2 text-[#cbb27c]">机制说明</h4>
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
          {gameText(ability.lore, vals)}
        </p>
      )}
    </article>
  );
}
