"use client";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  useRef,
  useLayoutEffect,
  useId,
  type PointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { useLocale, useTranslations } from "@/i18n/provider";
import { numbers } from "@/presentation/dota";
import {
  projectRankingHero,
  rankHeroValue,
  type HeroRankingRow,
  type RankedPoint,
} from "@/presentation/hero-stat-rankings";
import type { HeroStatModifier } from "@/domain/hero-build";
import { HoverTooltip } from "./ui/hover-tooltip";
import { heroStatLabels } from "./hero-stats-relations";

const Rankings = createContext<{
  peers: ReturnType<typeof projectRankingHero>[];
  current: ReturnType<typeof projectRankingHero>;
  level: number;
  count: number;
} | null>(null);

export function HeroRankingScope({
  heroes,
  hero,
  level,
  sourceCommit,
  modifiers,
  children,
}: {
  heroes: readonly HeroRankingRow[];
  hero: HeroRankingRow;
  level: number;
  sourceCommit: string | null;
  modifiers: readonly HeroStatModifier[];
  children: ReactNode;
}) {
  const peers = useMemo(
    () => heroes.map((row) => projectRankingHero(row, level, sourceCommit)),
    [heroes, level, sourceCommit],
  );
  const current = useMemo(
    () => projectRankingHero(hero, level, sourceCommit, modifiers),
    [hero, level, sourceCommit, modifiers],
  );
  return (
    <Rankings value={{ peers, current, level, count: heroes.length }}>
      {children}
    </Rankings>
  );
}

export function HeroRankValue({
  stat,
  endStat,
  label,
  children,
}: {
  stat: string;
  endStat?: string;
  label?: string;
  children: ReactNode;
}) {
  const context = useContext(Rankings);
  const t = useTranslations();
  if (!context || !context.count) return <>{children}</>;
  const title = label ?? t(heroStatLabels[stat.replace(/^raw:/, "")] ?? stat);
  return (
    <HoverTooltip
      avoidAnchor
      className="inline cursor-help rounded-sm text-inherit tabular-nums hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-[#e4c584]"
      buttonProps={{ "aria-label": `${title} · ${t("全英雄排名")}` }}
      content={
        <div className="w-[min(350px,82vw)] text-xs" data-hero-ranking={stat}>
          <strong className="text-[#e4c584]">
            {title} · {t("全英雄排名")}
          </strong>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            {t("同版本 · {level}级 · 数值从高到低", { level: context.level })}
          </p>
          {[stat, ...(endStat ? [endStat] : [])].map((key, i) => (
            <div key={key}>
              {endStat && (
                <p className="mt-2 font-medium">{t(i ? "上限" : "下限")}</p>
              )}
              <RankingDistribution stat={key} kind="values" />
              {Object.hasOwn(context.current.growth, key) && (
                <RankingDistribution stat={key} kind="growth" />
              )}
            </div>
          ))}
          <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
            {t(
              "当前配置值，对比其他英雄同等级基础面板（无装备、天赋及技能加成）。数值排名不代表战斗优劣。",
            )}
          </p>
          <p className="mt-1 text-[10px] text-[var(--text-muted)]">
            {t(
              "P值为低于当前值的英雄占非同值英雄的比例；最高P100、最低P0，全体相同为P50。",
            )}
          </p>
        </div>
      }
    >
      {children}
    </HoverTooltip>
  );
}

function RankingDistribution({
  stat,
  kind,
}: {
  stat: string;
  kind: "values" | "growth";
}) {
  const context = useContext(Rankings)!;
  const locale = useLocale();
  const t = useTranslations();
  const value = context.current[kind][stat];
  const peers: RankedPoint[] = context.peers.flatMap((peer) => {
    const number = peer[kind][stat];
    return number == null
      ? []
      : [{ id: peer.id, name: peer.name, value: number }];
  });
  if (value == null) return <p className="mt-2">{t("该数值缺少可比数据。")}</p>;
  const ranking = rankHeroValue(peers, {
    id: context.current.id,
    name: context.current.name,
    value,
  });
  return (
    <section className="mt-2" data-rank-kind={kind}>
      <div className="flex items-center justify-between gap-2">
        <span>
          {t(kind === "growth" ? "每级增量" : "当前值")}{" "}
          <b>{numbers(value, locale)}</b>
        </span>
        <strong className="text-[#e4c584]" data-rank-result>
          {ranking.equal > 1 ? t("并列") : ""}
          {t("第 {rank} / {total} 名", {
            rank: ranking.rank,
            total: ranking.total,
          })}{" "}
          · P{ranking.percentile}
        </strong>
      </div>
      <RankingChart
        ranking={ranking}
        currentId={context.current.id}
        value={value}
      />
      <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
        <span>{numbers(ranking.sorted[0].value, locale)}</span>
        <span className="text-[#e4c584]">{context.current.name}</span>
        <span>{numbers(ranking.sorted.at(-1)!.value, locale)}</span>
      </div>
      {kind === "growth" && (
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
          {t("保持配置不变：{from}→{to}级的增量", {
            from: Math.min(29, context.level),
            to: Math.min(30, context.level + 1),
          })}
        </p>
      )}
      {ranking.total < context.count && (
        <p className="text-[10px] text-[var(--text-muted)]">
          {t("排除 {count} 位缺值英雄", {
            count: context.count - ranking.total,
          })}
        </p>
      )}
    </section>
  );
}

/** One local tooltip and one pointer handler for the entire sorted distribution. */
function RankingChart({
  ranking,
  currentId,
  value,
}: {
  ranking: ReturnType<typeof rankHeroValue>;
  currentId: string;
  value: number;
}) {
  const locale = useLocale();
  const t = useTranslations();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const chart = useRef<HTMLDivElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const point = activeIndex === null ? null : ranking.sorted[activeIndex];
  useLayoutEffect(() => {
    if (activeIndex === null || !tooltip.current || !chart.current) return;
    const position = () => {
      const width = chart.current!.clientWidth;
      const popup = tooltip.current!;
      popup.style.left = `${Math.max(
        0,
        Math.min(
          width - popup.offsetWidth,
          ((activeIndex + 0.5) / ranking.total) * width - popup.offsetWidth / 2,
        ),
      )}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(chart.current);
    observer.observe(tooltip.current);
    return () => observer.disconnect();
  }, [activeIndex, ranking.total, point?.name, point?.value]);
  const selectPointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const next = Math.max(
      0,
      Math.min(
        ranking.total - 1,
        Math.floor(((event.clientX - rect.left) / rect.width) * ranking.total),
      ),
    );
    // Continuous pointer updates may otherwise commit after the next paint.
    // Only flush when crossing a bar; the sorted population stays unchanged.
    if (next !== activeIndex) flushSync(() => setActiveIndex(next));
  };
  const max = Math.max(0, ...ranking.sorted.map((point) => point.value));
  const min = Math.min(0, ...ranking.sorted.map((point) => point.value));
  const span = max - min || 1;
  const y = (n: number) => 6 + ((max - n) / span) * 54;
  const step = 320 / ranking.total;
  const x = (ranking.index + 0.5) * step;
  return (
    <div ref={chart} className="relative" data-ranking-chart>
      <svg
        viewBox="0 0 320 70"
        className="mt-1 block w-full"
        role="img"
        tabIndex={0}
        aria-describedby={activeIndex === null ? undefined : tooltipId}
        onPointerEnter={selectPointer}
        onPointerMove={selectPointer}
        onPointerDown={selectPointer}
        onPointerLeave={() => setActiveIndex(null)}
        onFocus={() => setActiveIndex((index) => index ?? ranking.index)}
        onBlur={() => setActiveIndex(null)}
        onKeyDown={(event) => {
          const index = activeIndex ?? ranking.index;
          const next =
            event.key === "ArrowLeft"
              ? index - 1
              : event.key === "ArrowRight"
                ? index + 1
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? ranking.total - 1
                    : null;
          if (next !== null) {
            event.preventDefault();
            setActiveIndex(Math.max(0, Math.min(ranking.total - 1, next)));
          }
        }}
        aria-label={t("全英雄排序分布，当前第{rank}名，P{percentile}", {
          rank: ranking.rank,
          percentile: ranking.percentile,
        })}
      >
        <line
          x1="0"
          x2="320"
          y1={y(0)}
          y2={y(0)}
          stroke="#71818c"
          strokeOpacity=".4"
        />
        {ranking.sorted.map((point, index) => (
          <rect
            key={point.id}
            x={index * step + 0.15}
            y={Math.min(y(point.value), y(0))}
            width={Math.max(0.5, step - 0.3)}
            height={Math.max(1, Math.abs(y(point.value) - y(0)))}
            fill={point.id === currentId ? "#edc76d" : "#7099b4"}
            opacity={point.id === currentId || index === activeIndex ? 1 : 0.55}
          />
        ))}
        <line x1={x} x2={x} y1="2" y2="67" stroke="#ffe1a0" strokeWidth="1.5" />
        <circle cx={x} cy={y(value)} r="3" fill="#ffe1a0" />
      </svg>
      {point && (
        <div
          ref={tooltip}
          id={tooltipId}
          role="tooltip"
          data-rank-point-tooltip
          className="pointer-events-none absolute top-0 z-10 max-w-full rounded-sm border border-[#e4c584]/40 bg-[#17232b] px-2 py-1 text-xs text-[#f0e5ce] shadow-lg"
        >
          {point.name}:{" "}
          <strong className="tabular-nums">
            {numbers(point.value, locale)}
          </strong>
        </div>
      )}
    </div>
  );
}
