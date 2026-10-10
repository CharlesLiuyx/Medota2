"use client";
import type { Translator } from "@/i18n/messages";
import { useTranslations } from "@/i18n/provider";
import { EntityCatalogTable } from "./entity-catalog-table";
import { heroTableEntry } from "./catalog-table-projections";
import { useLocale } from "@/i18n/provider";
import { memo, useCallback } from "react";
import type { HeroCardRow } from "@/server/repositories/heroes";
import type { PrimaryAttribute } from "@/domain/heroes";
import type { VersionedListSlice } from "@/domain/infinite-list";
import { HeroCard } from "./hero-card";
import {
  InfiniteList,
  type InfiniteChunkRenderContext,
  type InfiniteListMessages,
} from "./infinite-list";
export interface InfiniteHeroCatalogProps {
  initialSlice: VersionedListSlice<HeroCardRow>;
  endpoint: string;
  local?: boolean;
  paused?: boolean;
  view?: "grid" | "table";
  lang: "en" | "zh-CN";
}
const ATTRIBUTE_NAMES: Record<
  PrimaryAttribute,
  {
    zh: string;
    en: string;
  }
> = {
  strength: { zh: "力量", en: "Strength" },
  agility: { zh: "敏捷", en: "Agility" },
  intelligence: { zh: "智力", en: "Intelligence" },
  universal: { zh: "全才", en: "Universal" },
};
export const InfiniteHeroCatalog = memo(function InfiniteHeroCatalog({
  initialSlice,
  endpoint,
  local = false,
  paused = false,
  lang,
  view = "grid",
}: InfiniteHeroCatalogProps) {
  const t = useTranslations();
  const locale = useLocale();
  const project = useCallback(
    (item: HeroCardRow) =>
      heroTableEntry(
        item,
        initialSlice.assetDatasetVersionId,
        locale,
        lang === "en",
        t,
      ),
    [initialSlice.assetDatasetVersionId, locale, lang, t],
  );
  if (view === "table")
    return (
      <EntityCatalogTable
        kind="hero"
        source={
          local
            ? {
                kind: "local",
                items: initialSlice.items,
                chunkSize: 8,
                identity: `${endpoint}:table:local`,
              }
            : { kind: "remote", endpoint, initialSlice }
        }
        getKey={heroKey}
        project={project}
        paused={paused}
        label={t("英雄结果")}
      />
    );
  return (
    <InfiniteList
      paused={paused}
      source={
        local
          ? {
              kind: "local",
              items: initialSlice.items,
              chunkSize: 48,
              identity: `${endpoint}:local`,
            }
          : { kind: "remote", endpoint, initialSlice }
      }
      showComplete
      getKey={heroKey}
      onStale={reloadCurrentCatalog}
      messages={heroMessages(t)}
      ariaLabel={t("英雄结果")}
      contentRole="group"
      className="hero-catalog-flow mt-5"
      chunkClassName="hero-catalog-chunk"
      emptyFallback={<HeroCatalogEmpty />}
      renderChunk={(heroes, context) => (
        <HeroChunk
          heroes={heroes}
          context={context}
          groupCounts={initialSlice.groupCounts}
          assetVersion={initialSlice.assetDatasetVersionId}
          lang={lang}
        />
      )}
    />
  );
});
function reloadCurrentCatalog() {
  window.location.reload();
}
function HeroChunk({
  heroes,
  context,
  groupCounts,
  assetVersion,
  lang,
}: {
  heroes: readonly HeroCardRow[];
  context: InfiniteChunkRenderContext<HeroCardRow>;
  groupCounts: Record<string, number> | undefined;
  assetVersion: string;
  lang: "en" | "zh-CN";
}) {
  const t = useTranslations();
  const runs = groupRuns(heroes);
  const previousAttribute = toPrimaryAttribute(
    context.previousItem?.primaryAttribute,
  );
  return (
    <div className="hero-catalog-runs">
      {runs.map((run, runIndex) => {
        const showHeading = runIndex > 0 || run.attribute !== previousAttribute;
        const headingId = `${run.attribute}-heroes`;
        const names = ATTRIBUTE_NAMES[run.attribute];
        return (
          <section
            key={`${run.attribute}-${runIndex}`}
            className="hero-catalog-run"
            role="group"
            aria-labelledby={showHeading ? headingId : undefined}
            aria-label={!showHeading ? t(names.zh) : undefined}
          >
            {showHeading && (
              <div
                id={headingId}
                data-hero-group-heading={run.attribute}
                className="flex items-center gap-2 pb-2"
              >
                <h2
                  className="text-sm font-semibold"
                  style={{ color: `var(--attribute-${run.attribute})` }}
                >
                  {t(names.zh)}
                </h2>
                <span className="font-data text-[11px] text-[var(--text-muted)]">
                  {groupCounts?.[run.attribute]}
                </span>
              </div>
            )}
            <div
              className={`catalog-grid hero-catalog-grid ${showHeading ? "mt-2" : ""}`}
              role="list"
              aria-label={t("{value0} {value1}", {
                value0: t(names.zh),
                value1: t("英雄"),
              })}
            >
              {run.heroes.map((hero) => (
                <div
                  key={hero.heroId}
                  role="listitem"
                  data-infinite-list-item=""
                  data-infinite-list-key={hero.heroId}
                  className="min-w-0"
                  data-hero-attribute={run.attribute}
                >
                  <HeroCard
                    hero={hero}
                    assetVersion={assetVersion}
                    lang={lang}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
function groupRuns(heroes: readonly HeroCardRow[]): Array<{
  attribute: PrimaryAttribute;
  heroes: HeroCardRow[];
}> {
  const runs: Array<{
    attribute: PrimaryAttribute;
    heroes: HeroCardRow[];
  }> = [];
  for (const hero of heroes) {
    const attribute = toPrimaryAttribute(hero.primaryAttribute);
    if (!attribute) continue;
    const current = runs.at(-1);
    if (current?.attribute === attribute) current.heroes.push(hero);
    else runs.push({ attribute, heroes: [hero] });
  }
  return runs;
}
function toPrimaryAttribute(
  value: string | undefined,
): PrimaryAttribute | undefined {
  return value === "strength" ||
    value === "agility" ||
    value === "intelligence" ||
    value === "universal"
    ? value
    : undefined;
}
function heroKey(hero: HeroCardRow): number {
  return hero.heroId;
}
function heroMessages(t: Translator): InfiniteListMessages {
  return {
    loadingBefore: t("正在加载更早的英雄…"),
    loadingAfter: t("正在加载更多英雄…"),
    loadFailed: t("英雄加载失败。"),
    retryBefore: t("重试加载更早英雄"),
    retryAfter: t("重试加载更多英雄"),
    complete: t("已显示全部英雄。"),
    loaded: (shown, total) =>
      total === undefined
        ? t("已显示 {shown} 个英雄。", { shown })
        : t("已显示 {shown} / {total} 个英雄。", { shown, total }),
  };
}
function HeroCatalogEmpty() {
  const t = useTranslations();
  return (
    <div className="mt-5 py-20 text-center">
      <p className="text-sm text-[var(--text-secondary)]">
        {t("当前数据集中没有匹配的英雄。")}
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {t("请尝试减少筛选条件或清除搜索词。")}
      </p>
    </div>
  );
}
