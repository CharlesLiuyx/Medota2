"use client";
import { SourceText } from "@/i18n/provider";
import { gameLocale } from "@/i18n/config";
import { unitVariant } from "@/presentation/map-labels";

import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { withRelease } from "@/domain/releases";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { UNIT_CATEGORIES, type UnitDefinition } from "@/domain/units";
import { useLocale, useTranslations } from "@/i18n/provider";
import { CatalogViewSwitch, useCatalogView } from "./catalog-view-switch";
import { EntityCatalogTable } from "./entity-catalog-table";
import { unitTableEntry } from "./catalog-table-projections";
import { CatalogHeader } from "./catalog-header";
import { CompactSelect } from "./ui/compact-select";
import { HoverTooltip } from "./ui/hover-tooltip";
import { UnitStats } from "./unit-stats";
import { UnitPortrait, type UnitPortraitRef } from "./unit-portrait";
const subscribeToHydration = () => () => {};
const hydrated = () => true;
const notHydrated = () => false;
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_'’\-]+/gu, "");
export function UnitCatalog({
  units,
  header,
}: {
  header: ReactNode;
  units: Array<
    UnitDefinition & {
      searchText: string;
      portrait?: UnitPortraitRef;
    }
  >;
}) {
  const view = useCatalogView();
  const params = useSearchParams();
  const t = useTranslations();
  const ready = useSyncExternalStore(
    subscribeToHydration,
    hydrated,
    notHydrated,
  );
  const q = (params.get("q") ?? "").slice(0, 100);
  const selected = params.get("category") ?? "all";
  const category = Object.hasOwn(UNIT_CATEGORIES, selected) ? selected : "all";
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
    for (const key of ["view", "sort", "order"]) {
      const value = params.get(key);
      if (value) search.set(key, value);
    }
    if (next.q.trim()) search.set("q", next.q.trim());
    if (next.category !== "all") search.set("category", next.category);
    search.set("lang", next.lang);
    window.history.replaceState(
      null,
      "",
      withRelease(
        `/units${search.size ? `?${search}` : ""}`,
        params.get("release"),
      ),
    );
  };
  const filtered = useMemo(() => {
    const words = q.trim().split(/\s+/u).map(normalize).filter(Boolean);
    return units.filter(
      (unit) =>
        (category === "all" || unit.category === category) &&
        words.every((word) => unit.searchText.includes(word)),
    );
  }, [units, q, category]);
  const project = useCallback(
    (item: (typeof units)[number]) =>
      unitTableEntry(item, lang, gameLocale(lang) === "en", t),
    [lang, t],
  );
  const select = (data: FormData) =>
    update({
      category: String(data.get("category")),
    });
  return (
    <>
      <CatalogHeader header={header} viewSwitch={<CatalogViewSwitch />}>
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
            <span className="sr-only">{t("搜索单位")}</span>
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
              placeholder={t("搜索单位中文、英文或拼音…")}
              className="h-8 w-full bg-transparent pl-7 pr-2 text-xs"
            />
          </label>
          <p
            role="status"
            className="shrink-0 whitespace-nowrap text-[11px] text-[var(--text-muted)]"
          >
            {filtered.length} / {units.length} {t("个单位定义")}
          </p>

          <CompactSelect
            name="category"
            disabled={!ready}
            label={t("分类")}
            value={category}
            onChange={select}
          >
            <option value="all">{t("全部分类")}</option>
            {Object.entries(UNIT_CATEGORIES).map(([value, label]) => (
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

      {view === "table" ? (
        <EntityCatalogTable
          kind="unit"
          columnItems={units}
          source={{
            kind: "local",
            items: filtered,
            chunkSize: 8,
            identity: `${params.get("release")}:${q}:${category}:${lang}`,
          }}
          getKey={(item) => item.internalName}
          project={project}
          label={t("单位结果")}
        />
      ) : (
        <ul
          aria-label={t("单位结果")}
          className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8"
        >
          {filtered.map((unit) => {
            const name = gameLocale(lang) === "en" ? unit.enName : unit.zhName;
            return (
              <li key={unit.internalName} className="min-w-0">
                <HoverTooltip
                  href={`/units/${unit.internalName}`}
                  className="flex h-[70px] items-center gap-2 overflow-hidden bg-[#182127]/65 p-2 hover:bg-[#25313a]"
                  content={
                    <>
                      <div className="flex items-center gap-2">
                        <UnitPortrait
                          name={name}
                          unitKey={unit.internalName}
                          portrait={unit.portrait}
                          large
                        />
                        <p className="text-sm font-semibold">
                          <SourceText
                            sourceLocale={
                              unit.nameLocales?.[
                                gameLocale(lang) === "en" ? "en" : "zh"
                              ]
                            }
                          >
                            {name}
                          </SourceText>
                        </p>
                      </div>
                      <p className="my-2 text-[11px] text-[#c4a16a]">
                        {t(UNIT_CATEGORIES[unit.category])} · {t(unit.team)} ·{" "}
                        {t(unit.attack)}
                        {unit.variant &&
                          ` · ${unitVariant(unit.variant, lang)}`}
                      </p>
                      <UnitStats unit={unit} compact />
                      <p className="mt-3 text-[10px] text-[var(--text-muted)]">
                        {t("基础定义值 · 点击查看属性与技能")}
                      </p>
                    </>
                  }
                >
                  <UnitPortrait
                    name={name}
                    unitKey={unit.internalName}
                    portrait={unit.portrait}
                  />
                  <div className="min-w-0">
                    <h2 className="truncate text-xs font-medium">
                      <SourceText
                        sourceLocale={
                          unit.nameLocales?.[
                            gameLocale(lang) === "en" ? "en" : "zh"
                          ]
                        }
                      >
                        {name}
                      </SourceText>
                    </h2>
                    <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">
                      {t(UNIT_CATEGORIES[unit.category])} · {t(unit.team)}
                    </p>
                    {unit.variant && (
                      <p className="truncate text-[10px] text-[#a8b4be]">
                        {unitVariant(unit.variant, lang)}
                      </p>
                    )}
                  </div>
                </HoverTooltip>
              </li>
            );
          })}
        </ul>
      )}
      {view === "grid" && !filtered.length && (
        <div className="py-16 text-center text-sm text-[var(--text-muted)]">
          {t("没有符合条件的单位，请调整关键词或分类。")}
        </div>
      )}
    </>
  );
}
