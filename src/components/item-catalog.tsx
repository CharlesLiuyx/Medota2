"use client";
import { SourceText } from "@/i18n/provider";
import { gameLocale } from "@/i18n/config";

import { useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { withRelease } from "@/domain/releases";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { ITEM_CATEGORIES, type ItemDefinition } from "@/domain/items";
import { useLocale, useTranslations } from "@/i18n/provider";
import { CatalogHeader } from "./catalog-header";
import { CompactSelect } from "./ui/compact-select";
import { HoverTooltip } from "./ui/hover-tooltip";
import { InfiniteList } from "./infinite-list";
import { ItemIcon } from "./item-icon";
import { ItemSummary } from "./item-summary";
const subscribeToHydration = () => () => {};
const hydrated = () => true;
const notHydrated = () => false;
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_'’\-]+/gu, "");
export function ItemCatalog({
  items,
  header,
  version,
  imageVersion,
}: {
  version: string;
  imageVersion: string | null;
  header: ReactNode;
  items: Array<
    ItemDefinition & {
      searchText: string;
    }
  >;
}) {
  const params = useSearchParams();
  const t = useTranslations();
  const ready = useSyncExternalStore(
    subscribeToHydration,
    hydrated,
    notHydrated,
  );
  const q = (params.get("q") ?? "").slice(0, 100);
  const selected = params.get("category") ?? "all";
  const category = Object.hasOwn(ITEM_CATEGORIES, selected) ? selected : "all";
  const lang = useLocale();
  const [draft, setDraft] = useState(q);
  const [previousQ, setPreviousQ] = useState(q);
  if (previousQ !== q) {
    setPreviousQ(q);
    setDraft(q);
  }
  const update = (values: { q?: string; category?: string; lang?: string }) => {
    const next = { q, category, lang, ...values };
    const search = new URLSearchParams();
    if (next.q.trim()) search.set("q", next.q.trim());
    if (next.category !== "all") search.set("category", next.category);
    search.set("lang", next.lang);
    window.history.replaceState(
      null,
      "",
      withRelease(
        `/items${search.size ? `?${search}` : ""}`,
        params.get("release"),
      ),
    );
  };
  const filtered = useMemo(() => {
    const words = q.trim().split(/\s+/u).map(normalize).filter(Boolean);
    return items.filter(
      (item) =>
        (category === "all" || item.category === category) &&
        words.every((word) => item.searchText.includes(word)),
    );
  }, [items, q, category]);
  const select = (data: FormData) =>
    update({
      category: String(data.get("category")),
    });
  return (
    <>
      <CatalogHeader header={header}>
        <form
          className="flex flex-wrap items-center gap-1.5"
          autoComplete="off"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="relative min-w-0 basis-full sm:w-60 sm:flex-none sm:basis-auto">
            <Search
              aria-hidden
              className="absolute left-1.5 top-2 size-3.5 text-[var(--text-muted)]"
            />
            <span className="sr-only">{t("搜索物品")}</span>
            <input
              name="q"
              disabled={!ready}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (!(event.nativeEvent as InputEvent).isComposing)
                  update({ q: event.target.value });
              }}
              onCompositionEnd={(event) =>
                update({ q: event.currentTarget.value })
              }
              maxLength={100}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t("搜索物品中文、英文或拼音…")}
              className="h-8 w-full bg-transparent pl-7 pr-2 text-xs"
            />
          </label>
          <p
            role="status"
            className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]"
          >
            {filtered.length} / {items.length} {t("个物品定义")}
          </p>

          <CompactSelect
            name="category"
            disabled={!ready}
            label={t("分类")}
            value={category}
            onChange={select}
          >
            <option value="all">{t("全部分类")}</option>
            {Object.entries(ITEM_CATEGORIES).map(([value, label]) => (
              <option key={value} value={value}>
                {t(label)}
              </option>
            ))}
          </CompactSelect>

          {(q || category !== "all") && (
            <button
              type="button"
              aria-label={t("清除筛选")}
              onClick={() => {
                setDraft("");
                update({ q: "", category: "all" });
              }}
              className="p-2 text-[var(--text-muted)]"
            >
              <X className="size-3.5" />
            </button>
          )}
        </form>
      </CatalogHeader>

      <InfiniteList
        source={{
          kind: "local",
          items: filtered,
          chunkSize: 48,
          identity: `${version}:${q}:${category}:${lang}`,
        }}
        getKey={(item) => item.internalName}
        ariaLabel={t("物品结果")}
        className="space-y-1"
        chunkClassName="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8"
        messages={{
          loaded: (shown, total) =>
            t("已显示 {value0} / {value1} 个物品", {
              value0: shown,
              value1: total ?? shown,
            }),
          loadingAfter: t("加载更多物品…"),
          loadingBefore: t("加载前面的物品…"),
          complete: t("已显示全部物品"),
          loadFailed: t("物品加载失败。"),
          retryBefore: t("重试加载前面的物品"),
          retryAfter: t("重试加载更多物品"),
        }}
        renderChunk={(chunk) =>
          chunk.map((item) => {
            const name = gameLocale(lang) === "en" ? item.enName : item.zhName;
            return (
              <div
                role="listitem"
                key={item.internalName}
                data-infinite-list-key={item.internalName}
                className="min-w-0"
              >
                <HoverTooltip
                  href={`/items/${item.internalName}`}

                  className="flex min-h-[76px] items-center gap-2 bg-[#182127]/65 p-2 hover:bg-[#25313a]"
                  content={
                    <>
                      <div className="mb-3 flex items-center gap-3">
                        <ItemIcon
                          itemKey={item.internalName}
                          version={imageVersion}
                          large
                        />
                        <p className="text-sm font-semibold">
                          <SourceText
                            sourceLocale={
                              item.nameLocales?.[
                                gameLocale(lang) === "en" ? "en" : "zh"
                              ]
                            }
                          >
                            {name}
                          </SourceText>
                        </p>
                      </div>
                      <ItemSummary
                        item={item}
                        en={gameLocale(lang) === "en"}
                        compact
                      />
                    </>
                  }
                >
                  <ItemIcon
                    itemKey={item.internalName}
                    version={imageVersion}
                  />
                  <div className="min-w-0 space-y-1">
                    <h2 className="text-xs font-medium">
                      <SourceText
                        sourceLocale={
                          item.nameLocales?.[
                            gameLocale(lang) === "en" ? "en" : "zh"
                          ]
                        }
                      >
                        {name}
                      </SourceText>
                    </h2>
                    <p className="text-[10px] text-[var(--text-muted)]">
                      {t(ITEM_CATEGORIES[item.category])}
                    </p>
                    <p className="text-[11px] text-[#c4a16a]">
                      {item.cost === null
                        ? t("价格未提供")
                        : t("{value0} 金币", {
                            value0: item.cost,
                          })}
                    </p>
                  </div>
                </HoverTooltip>
              </div>
            );
          })
        }
      />
      {!filtered.length && (
        <div className="py-16 text-center text-sm text-[var(--text-muted)]">
          {t("没有符合条件的物品，请调整关键词或分类。")}
        </div>
      )}
    </>
  );
}
