"use client";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { UNIT_CATEGORIES, type UnitDefinition } from "@/domain/units";
import { CompactSelect } from "./ui/compact-select";
import { HoverTooltip } from "./ui/hover-tooltip";
import { UnitStats } from "./unit-stats";
import { UnitPortrait, type UnitPortraitRef } from "./unit-portrait";
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_'’\-]+/gu, "");
export function UnitCatalog({
  units,
}: {
  units: Array<
    UnitDefinition & { searchText: string; portrait?: UnitPortraitRef }
  >;
}) {
  const params = useSearchParams();
  const q = (params.get("q") ?? "").slice(0, 100);
  const selected = params.get("category") ?? "all";
  const category = Object.hasOwn(UNIT_CATEGORIES, selected) ? selected : "all";
  const lang = params.get("lang") === "en" ? "en" : "zh-CN";
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
    if (next.lang === "en") search.set("lang", "en");
    window.history.replaceState(
      null,
      "",
      `/units${search.size ? `?${search}` : ""}`,
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
  const select = (data: FormData) =>
    update({
      category: String(data.get("category")),
      lang: String(data.get("lang")),
    });
  return (
    <>
      <form
        className="mt-3 flex flex-wrap items-center gap-1.5"
        autoComplete="off"
        onSubmit={(event) => event.preventDefault()}
      >
        <label className="relative min-w-0 basis-full sm:flex-1 sm:basis-44">
          <Search
            aria-hidden
            className="absolute left-1.5 top-2 size-3.5 text-[var(--text-muted)]"
          />
          <span className="sr-only">搜索单位</span>
          <input
            name="q"
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
            placeholder="搜索单位中文、英文或拼音…"
            className="h-8 w-full bg-transparent pl-7 pr-2 text-xs"
          />
        </label>
        <CompactSelect
          name="category"
          label="分类"
          value={category}
          onChange={select}
        >
          <option value="all">全部分类</option>
          {Object.entries(UNIT_CATEGORIES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </CompactSelect>
        <CompactSelect name="lang" label="语言" value={lang} onChange={select}>
          <option value="zh-CN">中文</option>
          <option value="en">English</option>
        </CompactSelect>
        {(q || category !== "all") && (
          <button
            type="button"
            aria-label="清除筛选"
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
      <p role="status" className="my-3 text-[11px] text-[var(--text-muted)]">
        {filtered.length} / {units.length} 个单位定义
      </p>
      <ul
        aria-label="单位结果"
        className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8"
      >
        {filtered.map((unit) => {
          const name = lang === "en" ? unit.enName : unit.zhName;
          return (
            <li key={unit.internalName} className="min-w-0">
              <HoverTooltip
                href={`/units/${unit.internalName}${lang === "en" ? "?lang=en" : ""}`}
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
                      <p className="text-sm font-semibold">{name}</p>
                    </div>
                    <p className="my-2 text-[11px] text-[#c4a16a]">
                      {UNIT_CATEGORIES[unit.category]} · {unit.team} ·{" "}
                      {unit.attack}
                      {unit.variant && ` · ${unit.variant}`}
                    </p>
                    <UnitStats unit={unit} compact />
                    <p className="mt-3 text-[10px] text-[var(--text-muted)]">
                      基础定义值 · 点击查看属性与技能
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
                  <h2 className="truncate text-xs font-medium">{name}</h2>
                  <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">
                    {UNIT_CATEGORIES[unit.category]} · {unit.team}
                  </p>
                  {unit.variant && (
                    <p className="truncate text-[10px] text-[#a8b4be]">
                      {unit.variant}
                    </p>
                  )}
                </div>
              </HoverTooltip>
            </li>
          );
        })}
      </ul>
      {!filtered.length && (
        <div className="py-16 text-center text-sm text-[var(--text-muted)]">
          没有符合条件的单位，请调整关键词或分类。
        </div>
      )}
    </>
  );
}
