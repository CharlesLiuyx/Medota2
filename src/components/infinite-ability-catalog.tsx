"use client";
import type { Translator } from "@/i18n/messages";
import { useTranslations } from "@/i18n/provider";
import { EntityCatalogTable } from "./entity-catalog-table";
import { abilityTableEntry } from "./catalog-table-projections";
import { useLocale } from "@/i18n/provider";
import { memo, useCallback } from "react";
import type { AbilityCardRow } from "@/server/repositories/abilities";
import type { VersionedListSlice } from "@/domain/infinite-list";
import { AbilityCard } from "./ability-card";
import { InfiniteList, type InfiniteListMessages } from "./infinite-list";
export interface InfiniteAbilityCatalogProps {
  initialSlice: VersionedListSlice<AbilityCardRow>;
  endpoint: string;
  local?: boolean;
  paused?: boolean;
  view?: "grid" | "table";
  lang: "en" | "zh-CN";
}
export const InfiniteAbilityCatalog = memo(function InfiniteAbilityCatalog({
  initialSlice,
  endpoint,
  local = false,
  paused = false,
  lang,
  view = "grid",
}: InfiniteAbilityCatalogProps) {
  const t = useTranslations();
  const locale = useLocale();
  const project = useCallback(
    (item: AbilityCardRow) =>
      abilityTableEntry(item, initialSlice.assetDatasetVersionId, locale, t),
    [initialSlice.assetDatasetVersionId, locale, t],
  );
  if (view === "table")
    return (
      <EntityCatalogTable
        kind="ability"
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
        getKey={abilityKey}
        project={project}
        paused={paused}
        label={t("技能结果")}
      />
    );
  const messages = abilityMessages(t);
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
      getKey={abilityKey}
      onStale={reloadCurrentCatalog}
      messages={messages}
      ariaLabel={t("技能结果")}
      className="ability-catalog-flow mt-3"
      chunkClassName="ability-catalog-chunk"
      emptyFallback={<CatalogEmpty />}
      renderChunk={(abilities) => (
        <div className="ability-catalog-grid">
          {abilities.map((ability) => (
            <div
              key={ability.internalName}
              role="listitem"
              data-infinite-list-item=""
              data-infinite-list-key={ability.internalName}
              className="min-w-0"
            >
              <AbilityCard
                ability={ability}
                assetVersion={initialSlice.assetDatasetVersionId}
                lang={lang}
              />
            </div>
          ))}
        </div>
      )}
    />
  );
});
function reloadCurrentCatalog() {
  window.location.reload();
}
function abilityKey(ability: AbilityCardRow): string {
  return ability.internalName;
}
function abilityMessages(t: Translator): InfiniteListMessages {
  return {
    loadingBefore: t("正在加载更早的技能…"),
    loadingAfter: t("正在加载更多技能…"),
    loadFailed: t("技能加载失败。"),
    retryBefore: t("重试加载更早技能"),
    retryAfter: t("重试加载更多技能"),
    complete: t("已显示全部技能。"),
    loaded: (shown, total) =>
      total === undefined
        ? t("已显示 {shown} 个技能。", { shown })
        : t("已显示 {shown} / {total} 个技能。", { shown, total }),
  };
}
function CatalogEmpty() {
  const t = useTranslations();
  return (
    <div className="mt-6 py-20 text-center">
      <p className="text-sm text-[var(--text-secondary)]">
        {t("当前数据集中没有匹配的技能。")}
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {t("请尝试减少筛选条件或清除搜索词。")}
      </p>
    </div>
  );
}
