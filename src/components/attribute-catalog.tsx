"use client";
import { useEffect, useMemo, useState } from "react";
import {
  formatAttributeEnum,
  type AttributeEnumValue,
} from "@/domain/attribute-enums";
import type { ListSlice } from "@/domain/infinite-list";
import { useSearchParams } from "next/navigation";
import Link from "./version-link";
import { useLocale, useTranslations } from "@/i18n/provider";
import { CompactSelect } from "./ui/compact-select";
import { InfiniteList } from "./infinite-list";
import type { AttributeSummary, AttributeRelation } from "@/domain/attributes";
const normalized = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_'’\-]+/gu, "");
const kinds: Record<string, string> = {
  hero: "英雄",
  ability: "技能",
  unit: "单位",
  item: "物品",
};
export function AttributeCatalog({
  initialSlice,
  version,
}: {
  initialSlice: ListSlice<Omit<AttributeSummary, "searchText">>;
  version: string;
}) {
  const params = useSearchParams(),
    t = useTranslations(),
    locale = useLocale();
  const q = params.get("q") ?? "",
    scope = params.get("scope") ?? "common";
  const [draft, setDraft] = useState(q),
    [previous, setPrevious] = useState(q);
  if (previous !== q) {
    setPrevious(q);
    setDraft(q);
  }
  const update = (query: string, nextScope = scope) => {
    const next = new URLSearchParams(params.toString());
    if (query) next.set("q", query);
    else next.delete("q");
    next.set("scope", nextScope);
    window.history.replaceState(null, "", `?${next}`);
  };
  const endpoint = `/api/attributes?${new URLSearchParams({ q, scope, release: params.get("release") ?? "" })}`;
  const [loaded, setLoaded] = useState({
    endpoint,
    slice: initialSlice,
    error: false,
  });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(endpoint, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("Attribute request failed");
          return response.json() as Promise<
            ListSlice<Omit<AttributeSummary, "searchText">>
          >;
        })
        .then((slice) => {
          if (!controller.signal.aborted)
            setLoaded({ endpoint, slice, error: false });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setLoaded({
              endpoint,
              slice: { items: [], nextCursor: null, previousCursor: null },
              error: true,
            });
        });
    }, 80);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, retry]);
  const renderEntry = (entry: Omit<AttributeSummary, "searchText">) => (
    <div key={entry.id} role="listitem" className="min-w-0">
      <Link
        prefetch={false}
        href={`/attributes/${encodeURIComponent(entry.id)}`}
        className="block h-full space-y-2 bg-[#182127]/65 p-3 hover:bg-[#25313a]"
      >
        <h2 className="text-sm font-semibold">
          {locale === "en" ? entry.en : entry.zh}
        </h2>
        <p className="line-clamp-2 text-xs text-[var(--text-muted)]">
          {entry.owner || t(entry.summary)}
        </p>
        <p className="text-[11px] text-[#c4a16a]">
          {entry.count ? (
            <>
              {entry.kinds.map((k) => t(kinds[k])).join(" · ")} ·{" "}
              {t("{value0} 条关联", { value0: entry.count })}
            </>
          ) : (
            t("关联数值待核验")
          )}
        </p>
      </Link>
    </div>
  );
  const ready = loaded.endpoint === endpoint;
  const total = ready ? loaded.slice.total : undefined;
  return (
    <>
      <div className="my-4 flex flex-wrap items-center gap-2">
        <input
          aria-label={t("搜索属性")}
          placeholder={t("搜索属性、关联对象或拼音…")}
          value={draft}
          maxLength={100}
          onChange={(e) => {
            setDraft(e.target.value);
            if (!(e.nativeEvent as InputEvent).isComposing)
              update(e.target.value);
          }}
          onCompositionEnd={(e) => update(e.currentTarget.value)}
          className="h-8 min-w-0 flex-1 bg-white/5 px-3 text-xs"
        />
        <CompactSelect
          label={t("属性范围")}
          value={scope}
          onValueChange={(value) => update(q, value)}
        >
          <option value="common">{t("通用属性")}</option>
          <option value="all">{t("全部属性与专属参数")}</option>
        </CompactSelect>
        {q && (
          <button className="p-2 text-xs" onClick={() => update("")}>
            {t("清除筛选")}
          </button>
        )}
      </div>
      <p role="status" className="mb-3 text-xs text-[var(--text-muted)]">
        {total === undefined
          ? t("正在加载属性…")
          : t("{value0} 个属性", { value0: total })}
      </p>
      {ready && !loaded.error && total === 0 && (
        <p className="text-sm">
          {t("没有符合条件的属性，请调整关键词或范围。")}
        </p>
      )}
      {ready && loaded.error && (
        <button onClick={() => setRetry((value) => value + 1)}>
          {t("属性加载失败，点击重试")}
        </button>
      )}
      {ready && !loaded.error && (
        <InfiniteList
          source={{
            kind: "remote",
            endpoint,
            initialSlice: loaded.slice,
            identity: `grid-v2:${version}:${locale}:${endpoint}`,
          }}
          getKey={(entry) => entry.id}
          ariaLabel={t("属性结果")}
          className="space-y-1"
          chunkClassName="space-y-4"
          renderChunk={(chunk) => {
            const primary = chunk.filter((entry) =>
              ["strength", "agility", "intelligence"].includes(entry.id),
            );
            const rest = chunk.filter(
              (entry) =>
                !["strength", "agility", "intelligence"].includes(entry.id),
            );
            return (
              <>
                {primary.length > 0 && (
                  <section aria-label={t("基础属性")} className="space-y-2">
                    <h2 className="text-xs font-semibold text-[var(--text-muted)]">
                      {t("基础属性")}
                    </h2>
                    <div className="grid grid-cols-3 gap-1">
                      {primary.map(renderEntry)}
                    </div>
                  </section>
                )}
                <div className="grid grid-cols-2 gap-1 md:grid-cols-3 xl:grid-cols-4">
                  {rest.map(renderEntry)}
                </div>
              </>
            );
          }}
        />
      )}
    </>
  );
}
export function AttributeRelations({
  relations,
  enumValues,
  version,
}: {
  relations: AttributeRelation[];
  enumValues?: AttributeEnumValue[];
  version: string;
}) {
  const t = useTranslations(),
    locale = useLocale();
  const [enumValue, setEnumValue] = useState("all");
  const [kind, setKind] = useState("all"),
    [q, setQ] = useState("");
  const filtered = useMemo(
    () =>
      relations.filter(
        (r) =>
          (kind === "all" || r.kind === kind) &&
          (enumValue === "all" ||
            r.value
              .split("|")
              .map((v) => v.trim())
              .includes(enumValue)) &&
          normalized(`${r.zh} ${r.en} ${r.owner} ${r.field}`).includes(
            normalized(q),
          ),
      ),
    [relations, kind, q, enumValue],
  );
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{t("关联对象")}</h2>
      <p className="text-xs text-[var(--text-muted)]">
        {t(
          "以下是同版本定义中的引用，包含基础值、成长和来源参数；这些数值不能直接求和，也不代表全部在当前对局启用。",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label={t("搜索关联对象")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("搜索关联对象")}
          className="min-w-0 flex-1 bg-white/5 px-3 py-2 text-xs"
        />
        <CompactSelect
          label={t("对象类型")}
          value={kind}
          onValueChange={setKind}
        >
          <option value="all">{t("全部")}</option>
          {Object.entries(kinds).map(([value, label]) => (
            <option key={value} value={value}>
              {t(label)}
            </option>
          ))}
        </CompactSelect>
      </div>
      {enumValues && (
        <CompactSelect
          label={t("枚举值筛选")}
          value={enumValue}
          onValueChange={setEnumValue}
        >
          <option value="all">{t("全部枚举值")}</option>
          {enumValues.map((value) => (
            <option key={value.value} value={value.value}>
              {locale === "en" ? value.en : value.zh}
            </option>
          ))}
        </CompactSelect>
      )}
      <p role="status" className="text-xs text-[var(--text-muted)]">
        {t("{value0} 条关联", { value0: filtered.length })}
      </p>
      <InfiniteList
        source={{
          kind: "local",
          items: filtered,
          chunkSize: 48,
          identity: `${version}:${kind}:${q}:${locale}:${enumValue}`,
        }}
        getKey={(r) => `${r.kind}:${r.owner}:${r.field}`}
        ariaLabel={t("属性关联结果")}
        chunkClassName="grid gap-1 sm:grid-cols-2 xl:grid-cols-3"
        renderChunk={(chunk) =>
          chunk.map((r) => (
            <div
              key={`${r.kind}:${r.owner}:${r.field}`}
              role="listitem"
              className="min-w-0 bg-[#182127]/65 p-3 text-xs"
            >
              <div className="flex items-start justify-between gap-3">
                <Link
                  prefetch={false}
                  className="font-semibold text-[#c4a16a]"
                  href={r.href}
                >
                  {locale === "en" ? r.en : r.zh}
                </Link>
                <span className="shrink-0 text-[var(--text-muted)]">
                  {t(kinds[r.kind])}
                </span>
              </div>
              <div className="mt-2 flex justify-between gap-2">
                <span className="text-[var(--text-muted)]">
                  {r.kind === "hero"
                    ? t(
                        r.field.endsWith("_gain")
                          ? "每级成长"
                          : r.field.endsWith("_min")
                            ? "基础下限"
                            : r.field.endsWith("_max")
                              ? "基础上限"
                              : "基础值",
                      )
                    : r.kind === "unit"
                      ? t("基础值")
                      : t(locale === "en" ? r.labelEn : r.labelZh)}
                </span>
                <span className="min-w-0 text-right font-data [overflow-wrap:anywhere]">
                  {t(formatAttributeEnum(r.value, enumValues, locale))}
                </span>
              </div>
              <details className="mt-2 text-[var(--text-muted)]">
                <summary className="cursor-pointer">
                  {t("字段与条件依据")}
                </summary>
                <p className="mt-2 break-all">
                  {r.sourcePath}
                  {r.sourceLine ? `:${r.sourceLine}` : ""} · {r.field}
                </p>
                {Boolean(r.modifiers) && (
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap break-all text-[10px]">
                    {JSON.stringify(r.modifiers, null, 2)}
                  </pre>
                )}
              </details>
            </div>
          ))
        }
      />
    </section>
  );
}
