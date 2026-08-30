"use client";

import type { AbilityCardRow } from "@/server/repositories/abilities";
import type { VersionedListSlice } from "@/domain/infinite-list";
import { AbilityCard } from "./ability-card";
import { InfiniteList, type InfiniteListMessages } from "./infinite-list";

export interface InfiniteAbilityCatalogProps {
  initialSlice: VersionedListSlice<AbilityCardRow>;
  endpoint: string;
  lang: "en" | "zh-CN";
}

export function InfiniteAbilityCatalog({
  initialSlice,
  endpoint,
  lang,
}: InfiniteAbilityCatalogProps) {
  const messages = abilityMessages(lang);
  return (
    <InfiniteList
      source={{ kind: "remote", endpoint, initialSlice }}
      getKey={abilityKey}
      onStale={reloadCurrentCatalog}
      messages={messages}
      ariaLabel={lang === "en" ? "Ability results" : "技能结果"}
      className="mt-6 space-y-px"
      emptyFallback={<CatalogEmpty entity="abilities" lang={lang} />}
      renderChunk={(abilities) => (
        <div className="catalog-grid">
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
}

function reloadCurrentCatalog() {
  window.location.reload();
}

function abilityKey(ability: AbilityCardRow): string {
  return ability.internalName;
}

function abilityMessages(lang: "en" | "zh-CN"): InfiniteListMessages {
  if (lang === "en") {
    return {
      loadingBefore: "Loading earlier abilities…",
      loadingAfter: "Loading more abilities…",
      loadFailed: "Ability loading failed.",
      retryBefore: "Retry earlier abilities",
      retryAfter: "Retry more abilities",
      complete: "All abilities are shown.",
      loaded: (shown, total) =>
        total === undefined
          ? `${shown} abilities shown.`
          : `${shown} / ${total} abilities shown.`,
    };
  }
  return {
    loadingBefore: "正在加载更早的技能…",
    loadingAfter: "正在加载更多技能…",
    loadFailed: "技能加载失败。",
    retryBefore: "重试加载更早技能",
    retryAfter: "重试加载更多技能",
    complete: "已显示全部技能。",
    loaded: (shown, total) =>
      total === undefined
        ? `已显示 ${shown} 个技能。`
        : `已显示 ${shown} / ${total} 个技能。`,
  };
}

function CatalogEmpty({
  entity,
  lang,
}: {
  entity: "abilities";
  lang: "en" | "zh-CN";
}) {
  return (
    <div className="mt-6 border border-dashed border-[var(--border-default)] py-20 text-center">
      <p className="text-sm text-[var(--text-secondary)]">
        {lang === "en"
          ? `No matching ${entity}.`
          : "当前数据集中没有匹配的技能。"}
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {lang === "en"
          ? "Try removing a filter or clearing the search."
          : "请尝试减少筛选条件或清除搜索词。"}
      </p>
    </div>
  );
}
