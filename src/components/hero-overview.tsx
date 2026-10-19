"use client";

import { HeroRankValue, HeroRankingScope } from "./hero-stat-rankings";
import type { HeroRankingRow } from "@/presentation/hero-stat-rankings";
import { useId, useMemo, type ReactNode } from "react";
import { useLocale, useTranslations } from "@/i18n/provider";
import { selectedHeroTalents } from "@/domain/hero-build";
import { useHeroBuild } from "./hero-build-provider";
import { HeroInventoryPanel } from "./hero-inventory";
import { HeroTalentTree } from "./hero-talent-tree";
import {
  heroStatContributions,
  heroStatsAtLevel,
} from "@/presentation/hero-stats";
import { numbers } from "@/presentation/dota";
import {
  CalculatedStat,
  HeroCalculationScope,
  HeroStatRelation,
  HeroStatSegments,
} from "./hero-stats-relations";
import { PageInfoTooltip } from "./ui/page-info-tooltip";

const noRankingHeroes: readonly HeroRankingRow[] = [];

export function HeroOverview({
  intro,
  stats,
  hero,
  sourceCommit = null,
  rankingHeroes = noRankingHeroes,
  heroName = "",
}: {
  intro: ReactNode;
  stats: ReactNode;
  hero: Record<string, unknown>;
  sourceCommit?: string | null;
  rankingHeroes?: readonly HeroRankingRow[];
  heroName?: string;
}) {
  const context = useHeroBuild();
  if (!context) throw new Error("HeroOverview requires HeroBuildProvider");
  const { build, talents, dispatch } = context;
  const { level } = build;
  const selectedTalents = selectedHeroTalents(build, talents);
  const modifiers = [
    ...selectedTalents.flatMap((talent) => talent.effects),
    ...(context.inventoryProjection?.modifiers ?? []),
    ...context.abilityProjection.modifiers,
  ];
  const contributions = useMemo(
    () =>
      heroStatContributions(
        hero,
        level,
        sourceCommit,
        selectedHeroTalents(build, talents).flatMap((talent) => talent.effects),
        context.statStages,
      ),
    [hero, level, sourceCommit, build, talents, context.statStages],
  );
  const levelId = useId();
  const locale = useLocale();
  const t = useTranslations();
  const current = heroStatsAtLevel(hero, level, sourceCommit, modifiers);
  const ceiling = heroStatsAtLevel(hero, 30, sourceCommit, modifiers);
  const start = heroStatsAtLevel(hero, 1, sourceCommit);
  const attributeLink = (
    stat: keyof typeof current.calculations,
    label: string,
  ) => (
    <CalculatedStat stat={stat} label={t(label)}>
      {t(label)}
    </CalculatedStat>
  );
  return (
    <HeroCalculationScope
      calculations={current.calculations}
      contributions={contributions}
    >
      <HeroRankingScope
        heroes={rankingHeroes}
        hero={{
          ...hero,
          internal_name: String(hero.internal_name),
          name: heroName,
        }}
        level={level}
        sourceCommit={sourceCommit}
        modifiers={modifiers}
      >
        <div className="hero-overview mt-2 grid items-stretch gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] xl:grid-cols-[minmax(0,1fr)_minmax(232px,0.7fr)_minmax(0,2.15fr)]">
          <header className="hero-stage content-start">
            {intro}
            <HeroStatRelation field="level" className="col-span-full">
              <label
                htmlFor={levelId}
                className="col-span-full mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-xs text-[var(--text-secondary)]"
              >
                <span className="whitespace-nowrap">{t("英雄等级")}</span>
                <input
                  id={levelId}
                  type="range"
                  aria-label={t("英雄等级")}
                  min={1}
                  max={30}
                  step={1}
                  value={level}
                  onChange={(event) => {
                    const nextLevel = Number(event.target.value);
                    dispatch({ type: "level", level: nextLevel });
                  }}
                  className="h-5 w-full min-w-0 cursor-pointer accent-[#d8bc7f]"
                />
                <span className="min-w-10 whitespace-nowrap text-right tabular-nums">
                  <output className="font-semibold text-[#e4c584]">
                    {level}
                  </output>
                  <span className="text-[var(--text-muted)]"> / 30</span>
                </span>
              </label>
            </HeroStatRelation>
            <HeroTalentTree
              embedded
              talents={talents}
              build={build}
              onToggle={(id) => dispatch({ type: "talent", id })}
              onClear={() => dispatch({ type: "clear-talents" })}
            />
          </header>
          <HeroInventoryPanel />
          <section
            id="stats"
            className="dota-panel @container min-w-0 md:col-span-2 xl:col-span-1"
          >
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="text-sm font-medium text-[#d8c49a]">
                {t("英雄属性")}
              </h2>
              <PageInfoTooltip label={t("属性说明")}>
                {context.abilityProjection.unsupported.length > 0 && (
                  <p
                    className="w-full text-xs text-[var(--text-muted)]"
                    data-unmodeled-abilities
                  >
                    {t("部分条件／被动效果未计入，见技能说明。")}
                  </p>
                )}
                {t(
                  "按当前配置计算，默认满血、非战斗。条件与命石效果见对应说明。血／蓝条参照同配置30级上限＋1秒恢复。",
                )}
              </PageInfoTooltip>
              <div className="attribute-stack" aria-live="polite">
                {[
                  ["strength", "力量"],
                  ["agility", "敏捷"],
                  ["intelligence", "智力"],
                ].map(([key, label]) => {
                  const gain = hero[`${key}_gain`];
                  const value =
                    current[key as "strength" | "agility" | "intelligence"];
                  return (
                    <div key={key} style={{ color: `var(--attribute-${key})` }}>
                      <span>
                        <CalculatedStat
                          stat={key as "strength" | "agility" | "intelligence"}
                        >
                          {t(label)}
                        </CalculatedStat>
                      </span>
                      <strong data-hero-attribute={key}>
                        <HeroRankValue stat={key}>
                          {numbers(value, locale)}
                        </HeroRankValue>
                      </strong>
                      <small
                        aria-label={t("每级成长 {value0}", {
                          value0: numbers(gain, locale),
                        })}
                      >
                        <HeroRankValue stat={`raw:${key}_gain`}>
                          +{numbers(gain, locale)}
                        </HeroRankValue>
                      </small>
                    </div>
                  );
                })}
              </div>
            </div>
            {!current.supported && (
              <p className="mb-2 text-xs text-[var(--text-muted)]">
                {t("该版本的属性换算待核对，暂不计算派生面板。")}
              </p>
            )}
            <div className="grid gap-x-3 gap-y-1 @min-[480px]:grid-cols-2">
              {(
                [
                  [
                    "health",
                    "生命值上限",
                    "base_health",
                    "healthRegen",
                    "#83ce69",
                  ],
                  ["mana", "魔法值上限", "base_mana", "manaRegen", "#68afff"],
                ] as const
              ).map(([key, label, , regenKey, color]) => (
                <div
                  key={key}
                  data-stat-row={key}
                  className="grid min-h-6 min-w-0 grid-cols-[auto_minmax(12px,1fr)_auto] items-center gap-1.5 text-[11px]"
                >
                  <span className="whitespace-nowrap" style={{ color }}>
                    {attributeLink(key, key === "health" ? "生命值" : "魔法值")}
                  </span>
                  <StatMeter
                    name={t(label)}
                    stat={key}
                    contributions={contributions}
                    value={current[key]}
                    maximum={
                      ceiling[key] === null
                        ? null
                        : ceiling[key] + Math.max(0, ceiling[regenKey] ?? 0)
                    }
                    regeneration={current[regenKey]}
                    regenerationLabel={t("1秒恢复 {value}", {
                      value: numbers(current[regenKey], locale),
                    })}
                    initial={start[key]}
                    color={color}
                    large
                  />
                  <span className="flex items-baseline justify-end gap-1 whitespace-nowrap tabular-nums">
                    <strong
                      data-hero-stat={key}
                      className="text-xs text-[var(--text-primary)]"
                    >
                      <HeroRankValue stat={key}>
                        {numbers(current[key], locale)}
                      </HeroRankValue>
                    </strong>
                    <span className="text-[10px] text-[var(--text-secondary)]">
                      <CalculatedStat stat={regenKey}>{null}</CalculatedStat>
                      <HeroRankValue stat={regenKey}>
                        <span data-hero-stat={regenKey}>
                          {current[regenKey] !== null && current[regenKey] >= 0
                            ? "+"
                            : ""}
                          {numbers(current[regenKey], locale)}
                        </span>
                        {t("/ 秒").replaceAll(" ", "")}
                      </HeroRankValue>
                    </span>
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-1 grid gap-x-3 gap-y-1 @min-[480px]:grid-cols-2">
              {(
                [
                  ["damageMin", "攻击力", "base_attack_damage_min", "#e7b77a"],
                  ["armor", "护甲", "base_armor", "#b4c1d0"],
                  ["attackSpeed", "攻击速度", "base_attack_speed", "#e4c982"],
                  [
                    "magicResistance",
                    "魔法抗性",
                    "magic_resistance",
                    "#ba9bed",
                  ],
                ] as const
              ).map(([key, label, , color]) => {
                const suffix = key === "magicResistance" ? "%" : "";
                const value =
                  key === "damageMin"
                    ? `${numbers(current.damageMin, locale)} – ${numbers(current.damageMax, locale)}`
                    : `${numbers(current[key], locale)}${suffix}`;
                return (
                  <div
                    key={key}
                    data-stat-row={key}
                    className="grid min-h-6 min-w-0 grid-cols-[auto_minmax(12px,1fr)_auto] items-center gap-1.5 text-[11px]"
                  >
                    <span className="whitespace-nowrap text-[var(--text-secondary)]">
                      {attributeLink(key, label)}
                    </span>
                    <StatMeter
                      name={t(label)}
                      stat={key}
                      contributions={contributions}
                      value={current[key]}
                      maximum={ceiling[key]}
                      initial={start[key]}
                      color={color}
                    />
                    <strong
                      data-hero-stat={key}
                      className="min-w-10 text-right tabular-nums"
                      style={{ color }}
                    >
                      <HeroRankValue
                        stat={key}
                        endStat={key === "damageMin" ? "damageMax" : undefined}
                        label={t(label)}
                      >
                        {value}
                      </HeroRankValue>
                    </strong>
                  </div>
                );
              })}
            </div>
            <p className="my-1 text-[10px] text-[var(--text-muted)]">
              {t("血／蓝条淡色段为1秒恢复 · 细线100 · 粗线1000")}
            </p>
            <dl
              data-hero-summary-stats
              className="mt-2 flex flex-nowrap gap-x-3 overflow-x-auto pb-1 text-[11px] text-[var(--text-secondary)]"
            >
              <div className="flex shrink-0 gap-1 whitespace-nowrap">
                <dt>{attributeLink("movementSpeed", "移动速度")}</dt>
                <dd data-hero-stat="movementSpeed" className="tabular-nums">
                  <HeroRankValue stat="movementSpeed">
                    {numbers(current.movementSpeed, locale)}
                  </HeroRankValue>
                </dd>
              </div>
              <div className="flex shrink-0 gap-1 whitespace-nowrap">
                <dt>{attributeLink("attackRange", "攻击距离")}</dt>
                <dd data-hero-stat="attackRange" className="tabular-nums">
                  <HeroRankValue stat="attackRange">
                    {numbers(current.attackRange, locale)}
                  </HeroRankValue>
                </dd>
              </div>
              <div className="flex shrink-0 gap-1 whitespace-nowrap">
                <dt>{attributeLink("dayVision", "白天视野")}</dt>
                <dd data-hero-stat="dayVision" className="tabular-nums">
                  <HeroRankValue stat="dayVision">
                    {numbers(current.dayVision, locale)}
                  </HeroRankValue>
                </dd>
              </div>
              <div className="flex shrink-0 gap-1 whitespace-nowrap">
                <dt>{attributeLink("nightVision", "夜间视野")}</dt>
                <dd data-hero-stat="nightVision" className="tabular-nums">
                  <HeroRankValue stat="nightVision">
                    {numbers(current.nightVision, locale)}
                  </HeroRankValue>
                </dd>
              </div>
              <div className="flex shrink-0 gap-1 whitespace-nowrap">
                <dt>{attributeLink("baseAttackTime", "基础攻击间隔")}</dt>
                <dd data-hero-stat="baseAttackTime" className="tabular-nums">
                  <HeroRankValue stat="baseAttackTime">
                    {numbers(current.baseAttackTime, locale)}
                    {t(" 秒")}
                  </HeroRankValue>
                </dd>
              </div>
            </dl>
            <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-secondary)] empty:hidden">
              {(
                [
                  ["evasion", "闪避", "%"],
                  ["spellAmplification", "技能增强", "%"],
                  ["castRangeBonus", "施法距离加成", ""],
                  ["cooldownReduction", "冷却缩减", "%"],
                  ["lifesteal", "攻击吸血", "%"],
                  ["spellLifesteal", "技能吸血", "%"],
                  ["manaCostReduction", "魔耗降低", "%"],
                  ["slowResistance", "减速抗性", "%"],
                  ["knockbackResistance", "强制位移抗性", "%"],
                  ["statusResistance", "状态抗性", "%"],
                  ["debuffAmplification", "负面状态延长", "%"],
                  ["incomingDamage", "受到伤害增加", "%"],
                  ["onHitMagicDamage", "攻击附加魔法伤害", ""],
                  ["castSpeed", "施法速度加成", "%"],
                  ["goldPerMinute", "每分钟金钱加成", ""],
                  ["healingAmplification", "治疗增强", "%"],
                  ["outgoingDamage", "造成伤害增加", "%"],
                  ["spellArea", "技能范围增加", "%"],
                ] as const
              )
                .filter(([key]) => current[key] !== null && current[key] !== 0)
                .map(([key, label, suffix]) => (
                  <div key={key} className="flex gap-1">
                    <dt>{attributeLink(key, label)}</dt>
                    <dd data-hero-stat={key}>
                      <HeroRankValue stat={key} label={t(label)}>
                        {numbers(current[key], locale)}
                        {suffix}
                      </HeroRankValue>
                    </dd>
                  </div>
                ))}
            </dl>
            <div className="mt-3 border-t border-white/5 pt-3 text-xs">
              {stats}
            </div>
          </section>
        </div>
      </HeroRankingScope>
    </HeroCalculationScope>
  );
}

function StatMeter({
  name,
  stat,
  value,
  maximum,
  initial,
  color,
  large = false,
  regeneration,
  regenerationLabel,
  contributions,
}: {
  name: string;
  stat: string;
  value: number | null;
  maximum: number | null;
  initial: number | null;
  color: string;
  large?: boolean;
  regeneration?: number | null;
  regenerationLabel?: string;
  contributions: ReturnType<typeof heroStatContributions>;
}) {
  const scaleId = useId();
  const known = value !== null && maximum !== null && initial !== null;
  const boundaries = contributions.sources.flatMap((source) =>
    source.changes[stat]
      ? [source.changes[stat].before, source.changes[stat].after]
      : [],
  );
  const min = known ? Math.min(0, value, maximum, initial, ...boundaries) : 0;
  const recovery =
    regeneration != null && Number.isFinite(regeneration)
      ? Math.max(0, regeneration)
      : 0;
  const max = known
    ? Math.max(value + recovery, maximum, initial, min + 1, ...boundaries)
    : 1;
  const percent = (n: number) =>
    Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100));
  return (
    <div
      className={`relative overflow-hidden rounded-sm bg-black/35 ${large ? "h-2.5" : "h-1.5"}`}
    >
      <span
        role={known ? "meter" : undefined}
        aria-label={name}
        aria-valuenow={known ? value : undefined}
        aria-valuetext={
          known && regeneration != null
            ? `${value} · ${regenerationLabel}`
            : undefined
        }
        aria-valuemin={min}
        aria-valuemax={max}
        className="sr-only"
      />
      {known && (
        <>
          <div
            data-hero-stat-fill={stat}
            className="h-full transition-[width] duration-150 motion-reduce:transition-none"
            style={{
              visibility: boundaries.length ? "hidden" : undefined,
              width: `${percent(value)}%`,
              background: `linear-gradient(90deg, ${color}80, ${color})`,
            }}
          />
          <HeroStatSegments stat={stat} min={min} max={max} color={color} />
          {recovery > 0 && (
            <span
              data-hero-stat-regen={stat}
              title={regenerationLabel}
              aria-hidden="true"
              className="absolute inset-y-0 transition-[left,width] duration-150 motion-reduce:transition-none"
              style={{
                left: `${percent(value)}%`,
                width: `${percent(value + recovery) - percent(value)}%`,
                background: `color-mix(in srgb, ${color} 35%, white)`,
              }}
            />
          )}
          <svg
            aria-hidden="true"
            focusable="false"
            data-stat-scale={stat}
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`${min} 0 ${max - min} 1`}
            preserveAspectRatio="none"
          >
            <defs>
              {[100, 1000].map((step) => (
                <pattern
                  key={step}
                  id={`${scaleId}-${step}`}
                  data-scale-step={step}
                  patternUnits="userSpaceOnUse"
                  overflow="visible"
                  width={step}
                  height={1}
                >
                  <path
                    d="M0 0V1"
                    fill="none"
                    stroke={step === 1000 ? "#ffffffb3" : "#ffffff60"}
                    strokeWidth={step === 1000 ? 2 : 1}
                    vectorEffect="non-scaling-stroke"
                  />
                </pattern>
              ))}
            </defs>
            {[100, 1000].map((step) => (
              <rect
                key={step}
                x={min}
                y={0}
                width={max - min}
                height={1}
                fill={`url(#${scaleId}-${step})`}
              />
            ))}
          </svg>
        </>
      )}
    </div>
  );
}
