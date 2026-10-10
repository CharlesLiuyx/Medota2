"use client";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { RotateCcw } from "lucide-react";
import type { AttributeOwnerKind } from "@/domain/attributes";
import { parseCatalogTablePreferences } from "@/presentation/catalog-table-columns";
import { useTranslations } from "@/i18n/provider";
import { CompactFilterMenu } from "./ui/compact-filter-menu";
import { InfiniteList } from "./infinite-list";

const listeners = new Set<() => void>();
const memory = new Map<string, string | null>();
const memoryOnly = new Set<string>();
const preferenceKey = (kind: AttributeOwnerKind) =>
  `medota2:catalog-columns:v1:${kind}`;
const serverSnapshot = () => null;
const subscribeToToolbar = () => () => {};
const toolbarSnapshot = () =>
  document.querySelector<HTMLElement>("[data-catalog-table-tools]");
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}
export function useCatalogColumns(kind: AttributeOwnerKind) {
  const read = useCallback(() => {
    if (memoryOnly.has(kind)) return memory.get(kind) ?? null;
    try {
      return localStorage.getItem(preferenceKey(kind));
    } catch {
      return memory.get(kind) ?? null;
    }
  }, [kind]);
  const raw = useSyncExternalStore(subscribe, read, serverSnapshot);
  const preference = useMemo(() => parseCatalogTablePreferences(raw), [raw]);
  const selected = preference.columns;
  const [saveFailed, setSaveFailed] = useState(false);
  const persist = (settings: typeof preference | null) => {
    const value =
      settings === null ? null : JSON.stringify({ version: 1, ...settings });
    memory.set(kind, value);
    try {
      if (value === null) localStorage.removeItem(preferenceKey(kind));
      else localStorage.setItem(preferenceKey(kind), value);
      memoryOnly.delete(kind);
      setSaveFailed(false);
    } catch {
      memoryOnly.add(kind);
      setSaveFailed(true);
    }
    for (const listener of listeners) listener();
  };
  const save = (columns: string[] | null) => {
    const ordered = columns === null ? null : [...new Set(columns)];
    if (ordered && !ordered.includes("entity")) ordered.unshift("entity");
    persist(columns === null ? null : { ...preference, columns: ordered });
  };
  const setDecimals = (key: string, digits: number | undefined) => {
    const decimals = { ...preference.decimals };
    if (digits === undefined) delete decimals[key];
    else decimals[key] = digits;
    persist({ ...preference, decimals });
  };
  return {
    selected,
    save,
    saveFailed,
    decimals: preference.decimals,
    setDecimals,
    frozenThrough: preference.frozenThrough,
    setFrozenThrough: (key: string | null) =>
      persist({ ...preference, frozenThrough: key }),
  };
}
export interface CatalogColumnOption {
  key: string;
  name: string;
  detail?: string;
  search?: string;
}
const optionKey = (option: CatalogColumnOption) => option.key;
export function CatalogTableColumnSettings({
  kind,
  options,
  selected,
  onChange,
  onReset,
  loading,
  failed,
  retry,
  saveFailed,
}: {
  kind: AttributeOwnerKind;
  options: CatalogColumnOption[];
  selected: string[];
  onChange: (columns: string[]) => void;
  onReset: () => void;
  loading: boolean;
  failed: boolean;
  retry: () => void;
  saveFailed: boolean;
}) {
  const t = useTranslations();
  const target = useSyncExternalStore(
    subscribeToToolbar,
    toolbarSnapshot,
    serverSnapshot,
  );
  const [query, setQuery] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const matches = useMemo(() => {
    const words = query
      .toLocaleLowerCase()
      .trim()
      .split(/\s+/u)
      .filter(Boolean);
    return options.filter(
      (option) =>
        (!onlySelected || selectedSet.has(option.key)) &&
        words.every((word) =>
          `${option.name} ${option.detail ?? ""} ${option.search ?? ""}`
            .toLocaleLowerCase()
            .includes(word),
        ),
    );
  }, [options, query, onlySelected, selectedSet]);
  if (!target) return null;
  return createPortal(
    <div
      className="flex shrink-0 items-center gap-1 text-xs"
      data-catalog-column-settings
    >
      <CompactFilterMenu
        title={t("列配置")}
        count={options.filter((option) => selectedSet.has(option.key)).length}
      >
        <div className="w-[min(380px,calc(100vw-48px))]">
          <div className="sticky top-0 z-10 bg-[#171e25] p-2">
            <input
              type="search"
              aria-label={t("搜索列")}
              placeholder={t("搜索属性或对象名称…")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-8 w-full bg-white/5 px-2 text-xs outline-none focus:bg-white/10"
            />
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  className="compact-menu-checkbox"
                  checked={onlySelected}
                  onChange={(event) => setOnlySelected(event.target.checked)}
                />
                {t("只看已选")}
              </label>
              <span className="text-[var(--text-muted)]">
                {t("{count} 个可选列", { count: matches.length })}
              </span>
            </div>
            {loading && (
              <p role="status" className="mt-2 text-[var(--text-muted)]">
                {t("正在加载全部属性字段…")}
              </p>
            )}
            {failed && (
              <p role="alert" className="mt-2">
                {t("完整属性加载失败。")}{" "}
                <button type="button" className="underline" onClick={retry}>
                  {t("重试")}
                </button>
              </p>
            )}
          </div>
          <InfiniteList
            source={{
              kind: "local",
              items: matches,
              chunkSize: 40,
              identity: `${kind}:${query}:${onlySelected}:${matches.length}`,
            }}
            getKey={optionKey}
            ariaLabel={t("可选列")}
            emptyFallback={
              <p className="p-3 text-[var(--text-muted)]">
                {t("没有匹配的列。")}
              </p>
            }
            renderChunk={(chunk) =>
              chunk.map((option) => (
                <label
                  key={option.key}
                  className="compact-menu-option items-start"
                  role="listitem"
                >
                  <input
                    type="checkbox"
                    className="compact-menu-checkbox mt-0.5"
                    aria-label={option.name}
                    data-column-key={option.key}
                    checked={selectedSet.has(option.key)}
                    disabled={option.key === "entity"}
                    onChange={(event) =>
                      onChange(
                        event.target.checked
                          ? [...selected, option.key]
                          : selected.filter((key) => key !== option.key),
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span>{option.name}</span>
                    {option.detail && (
                      <span className="block break-words text-[10px] text-[var(--text-muted)]">
                        {option.detail}
                      </span>
                    )}
                  </span>
                </label>
              ))
            }
          />
        </div>
      </CompactFilterMenu>
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setOnlySelected(false);
          onReset();
        }}
        aria-label={t("重置表格")}
        title={t("重置表格")}
        className="inline-flex items-center gap-1 px-1 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <RotateCcw aria-hidden className="size-3" />
        <span className="hidden sm:inline">{t("重置表格")}</span>
      </button>
      {saveFailed && (
        <span role="alert" className="text-[var(--text-muted)]">
          {t("浏览器存储不可用，配置仅在当前页面保留。")}
        </span>
      )}
    </div>,
    target,
  );
}
