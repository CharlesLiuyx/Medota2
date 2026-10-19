"use client";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CalculatedAttributeIcon } from "./attribute-icon";
import { useLocale, useTranslations } from "@/i18n/provider";
import {
  expressionDependencies,
  expressionText,
  type HeroStatCalculations,
  type HeroStatContributions,
} from "@/presentation/hero-stats";
import type { StatExpression } from "@/presentation/hero-stats-expression";
import { HoverTooltip } from "./ui/hover-tooltip";
import styles from "./hero-stats-relations.module.css";

export const heroStatLabels: Record<string, string> = {
  level: "英雄等级",
  strength: "力量",
  agility: "敏捷",
  intelligence: "智力",
  base_strength: "基础力量",
  base_agility: "基础敏捷",
  base_intelligence: "基础智力",
  strength_gain: "力量成长",
  agility_gain: "敏捷成长",
  intelligence_gain: "智力成长",
  base_health: "基础生命值",
  base_health_regen: "基础生命恢复",
  base_mana: "基础魔法值",
  base_mana_regen: "基础魔法恢复",
  base_attack_damage_min: "基础攻击力下限",
  base_attack_damage_max: "基础攻击力上限",
  base_armor: "基础护甲",
  base_attack_speed: "基础攻击速度",
  attack_rate: "基础攻击间隔",
  magic_resistance: "基础魔法抗性",
  movement_speed: "基础移动速度",
  attack_range: "基础攻击距离",
  day_vision: "基础白天视野",
  night_vision: "基础夜间视野",
  health: "生命值",
  healthRegen: "生命恢复",
  mana: "魔法值",
  manaRegen: "魔法恢复",
  damageMin: "攻击力下限",
  damageMax: "攻击力上限",
  armor: "护甲",
  attackSpeed: "攻击速度",
  magicResistance: "魔法抗性",
  movementSpeed: "移动速度",
  attackRange: "攻击距离",
  dayVision: "白天视野",
  nightVision: "夜间视野",
  baseAttackTime: "基础攻击间隔",
  baseAttackDamage: "基础攻击力",
  attackDamage: "攻击力",
  baseAttackSpeed: "基础攻击速度",
  maxHealthRegen: "最大生命恢复比例",
  evasion: "闪避",
  cooldownReduction: "冷却缩减",
  lifesteal: "攻击吸血",
  spellLifesteal: "技能吸血",
  spellAmplification: "技能增强",
  manaCostReduction: "魔耗降低",
  slowResistance: "减速抗性",
  knockbackResistance: "强制位移抗性",
  statusResistance: "状态抗性",
  debuffAmplification: "负面状态延长",
  incomingDamage: "受到伤害增加",
  onHitMagicDamage: "攻击附加魔法伤害",
  castSpeed: "施法速度加成",
  goldPerMinute: "每分钟金钱加成",
  healingAmplification: "治疗增强",
  outgoingDamage: "造成伤害增加",
  spellArea: "技能范围增加",
  castRangeBonus: "施法距离加成",
};
const Context = createContext<{
  calculations: HeroStatCalculations;
  active: string | null;
  setActive: (key: string | null) => void;
  dependencies: Record<string, string[]>;
  contributions?: HeroStatContributions;
} | null>(null);
export function HeroCalculationScope({
  calculations,
  contributions,
  children,
}: {
  calculations: HeroStatCalculations;
  contributions?: HeroStatContributions;
  children: ReactNode;
}) {
  const [active, setActive] = useState<string | null>(null);
  const dependencies = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(calculations).map(([key, expression]) => [
          key,
          [
            ...expressionDependencies(expression),
            ...(contributions?.sources
              .filter((source) => source.changes[key])
              .map((source) => source.id) ?? []),
          ],
        ]),
      ),
    [calculations, contributions],
  );
  return (
    <Context
      value={{ calculations, active, setActive, dependencies, contributions }}
    >
      {children}
    </Context>
  );
}
function useRelation(keys: string[]) {
  const context = useContext(Context);
  const active = context?.active;
  const related =
    !!active &&
    keys.some(
      (key) =>
        key === active ||
        context?.dependencies[active]?.includes(key) ||
        context?.dependencies[key]?.includes(active),
    );
  return { context, related };
}
export function HeroStatRelation({
  field,
  children,
  className = "",
}: {
  field: string;
  children: ReactNode;
  className?: string;
}) {
  const keys =
    field === "base_attack_damage_min"
      ? [field, "base_attack_damage_max"]
      : [field];
  const { context, related } = useRelation(keys);
  return (
    <div
      data-stat-source={field}
      data-related={related || undefined}
      className={`${styles.relation} ${className}`}
      onPointerEnter={() => context?.setActive(field)}
      onPointerLeave={() => context?.setActive(null)}
      onFocus={() => context?.setActive(field)}
      onBlur={() => context?.setActive(null)}
    >
      {children}
    </div>
  );
}
export function CalculatedStat({
  stat,
  children,
  label,
}: {
  stat: keyof HeroStatCalculations;
  children: ReactNode;
  label?: string;
}) {
  const { context, related } = useRelation([stat]);
  const t = useTranslations();
  if (!context) return <>{children}</>;
  const name = (key: string): string => {
    if (key.startsWith("flat:") || key.startsWith("percent:")) {
      const [kind, field] = key.split(":");
      return `${t(heroStatLabels[field] ?? field)} · ${t(kind === "flat" ? "固定加成" : "百分比加成")}`;
    }
    if (key.includes(":source:"))
      return `${t(heroStatLabels[key.split(":")[0]])} · ${t("独立叠加加成")} ${Number(key.split(":")[2]) + 1}`;
    return t(heroStatLabels[key] ?? key);
  };
  const keys =
    stat === "damageMin" ? (["damageMin", "damageMax"] as const) : [stat];
  return (
    <span
      className={styles.calculated}
      data-calculated-stat={stat}
      data-related={related || undefined}
    >
      <HoverTooltip
        className={styles.trigger}
        buttonProps={{
          "aria-label": `${label ?? name(stat)} · ${t("计算方法")}`,
        }}
        onOpenChange={(open) => context.setActive(open ? stat : null)}
        content={
          <div
            className="max-w-[min(30rem,85vw)] text-xs"
            data-calculation-card={stat}
          >
            <strong className="text-[#e4c584]">
              {label ?? name(stat)} · {t("计算方法")}
            </strong>
            {keys.map((key) => {
              const expression = context.calculations[key];
              const inputs = new Map<string, StatExpression>();
              const collect = (node: StatExpression, root = false) => {
                if (node.key && (!root || !node.inputs))
                  inputs.set(node.key, node);
                node.inputs?.forEach((child) => collect(child));
              };
              collect(expression, true);
              return (
                <div key={key} className="mt-2 space-y-2">
                  {keys.length > 1 && <p>{name(key)}</p>}
                  <p className="break-words leading-relaxed">
                    {expressionText(expression, name)}
                  </p>
                  <p className="break-words font-mono leading-relaxed text-[#e4c584]">
                    {expressionText(expression, name, true)} ={" "}
                    {expression.value ?? "—"}
                  </p>
                  <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1">
                    {[...inputs].map(([input, node]) => (
                      <div key={input} className="contents">
                        <dt className="text-[var(--text-secondary)]">
                          {name(input)}
                        </dt>
                        <dd className="text-right tabular-nums">
                          {node.value ?? "—"}
                          {input.startsWith("percent:") ||
                          input.includes(":source:")
                            ? "%"
                            : ""}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {expression.value === null && (
                    <p>{t("来源数值缺失或该版本换算未核对。")}</p>
                  )}
                </div>
              );
            })}
            <p className="mt-3 text-[var(--text-muted)]">
              {t("加成来自当前天赋、技能、装备与状态；中间结果保留6位小数。")}
            </p>
          </div>
        }
      >
        <CalculatedAttributeIcon stat={stat} size="1em" aria-hidden="true" />
        <span>{children}</span>
      </HoverTooltip>
    </span>
  );
}

const statColors: Record<string, string> = {
  health: "#83ce69",
  healthRegen: "#83ce69",
  mana: "#68afff",
  manaRegen: "#68afff",
  damageMin: "#e7b77a",
  damageMax: "#e7b77a",
  armor: "#b4c1d0",
  attackSpeed: "#e4c982",
  magicResistance: "#ba9bed",
};
/** Keep each attribute hue; alternate light/dark so adjacent sources stay distinct. */
function segmentTone(color: string, index: number) {
  if (!index) return `color-mix(in srgb, ${color} 45%, black)`;
  const light = index % 2 === 1;
  const mix = light
    ? Math.min(80, 25 + Math.floor(index / 2) * 12)
    : Math.min(52, 12 + (index / 2 - 1) * 8);
  return `color-mix(in srgb, ${color} ${100 - mix}%, ${light ? "white" : "black"})`;
}
export function SourceChanges({ sourceId }: { sourceId: string }) {
  const context = useContext(Context),
    t = useTranslations(),
    locale = useLocale();
  const source = context?.contributions?.sources.find(
    (source) => source.id === sourceId,
  );
  if (!source) return null;
  return (
    <div
      className="mt-2 border-t border-white/10 pt-2"
      data-source-changes={sourceId}
    >
      <strong>{t("面板贡献")}</strong>
      {Object.entries(source.changes).length ? (
        <dl className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
          {Object.entries(source.changes).map(([stat, change]) => (
            <div className="contents" key={stat}>
              <dt>{t(heroStatLabels[stat] ?? stat)}</dt>
              <dd
                className="tabular-nums"
                style={{ color: statColors[stat] ?? "#e4c584" }}
              >
                {change.amount > 0 ? "+" : ""}
                {change.amount.toLocaleString(locale, {
                  maximumFractionDigits: 2,
                })}
                {stat === "magicResistance" ? t("百分点") : ""}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>{t("无已计入的面板加成")}</p>
      )}
      <p className="mt-2 text-[10px] text-[var(--text-muted)]">
        {t("按槽位→中立→附魔→状态计入，含乘法与升级联动；斜纹为扣减。")}
      </p>
    </div>
  );
}
export function HeroStatSegments({
  stat,
  min,
  max,
  color,
}: {
  stat: string;
  min: number;
  max: number;
  color: string;
}) {
  const context = useContext(Context),
    t = useTranslations(),
    locale = useLocale();
  const contributions = context?.contributions;
  const relevant =
    contributions?.sources.filter((source) => source.changes[stat]) ?? [];
  const base = contributions?.base?.[stat as keyof HeroStatCalculations]?.value;
  if (!relevant.length || base == null || !context) return null;
  const segments = [
    {
      id: "base",
      name: t("基础（等级、天赋、技能）"),
      before: 0,
      after: base,
      amount: base,
    },
    ...relevant.map((source) => ({
      id: source.id,
      name: locale === "en" && source.enName ? source.enName : t(source.name),
      ...source.changes[stat],
    })),
  ];
  const width = max - min;
  return (
    <div className="absolute inset-0" data-stat-segments={stat}>
      {segments.map((segment, index) => {
        const negative = segment.amount < 0;
        const active = context.active === segment.id || context.active === stat;
        const tint = segmentTone(color, index);
        return (
          <span
            key={segment.id}
            className="absolute inset-y-0"
            style={{
              left: `${(100 * (Math.min(segment.before, segment.after) - min)) / width}%`,
              width: `${(100 * Math.abs(segment.after - segment.before)) / width}%`,
            }}
            data-stat-segment={segment.id}
            data-contribution={segment.amount}
            data-related={active || undefined}
          >
            <HoverTooltip
              className="absolute inset-0 block w-full border-l border-white/40 focus-visible:outline-2 focus-visible:outline-white"
              buttonProps={{
                "aria-label": `${t(heroStatLabels[stat] ?? stat)} · ${segment.name}`,
              }}
              onOpenChange={(open) =>
                context.setActive(
                  open ? (segment.id === "base" ? stat : segment.id) : null,
                )
              }
              content={
                <div className="text-xs">
                  <strong>
                    {segment.name} · {t(heroStatLabels[stat] ?? stat)}
                  </strong>
                  <p className="mt-1 tabular-nums">
                    {segment.amount >= 0 ? "+" : ""}
                    {segment.amount.toLocaleString(locale, {
                      maximumFractionDigits: 2,
                    })}
                    {stat === "magicResistance" ? t("百分点") : ""} ·{" "}
                    {segment.before} → {segment.after}
                  </p>
                  {segment.id !== "base" && (
                    <SourceChanges sourceId={segment.id} />
                  )}
                </div>
              }
            >
              <span
                className="absolute inset-0"
                style={{
                  background: negative
                    ? `repeating-linear-gradient(135deg, ${tint} 0 2px, #182029 2px 4px)`
                    : tint,
                  opacity: 1,
                  boxShadow: active
                    ? "inset 0 0 0 1px white"
                    : "inset 1px 0 #172029",
                }}
              />
            </HoverTooltip>
          </span>
        );
      })}
    </div>
  );
}

export function useSourceHighlight() {
  return useContext(Context)?.setActive;
}
