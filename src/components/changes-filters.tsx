"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { CatalogHeader } from "./catalog-header";
import { Search } from "lucide-react";
import { useLocale, useTranslations } from "@/i18n/provider";
import { CompactSelect } from "./ui/compact-select";
import { useFilterEvents } from "./use-live-catalog";

type Filters = {
  release: string;
  from: string;
  entity: string;
  category: string;
  q: string;
};
type Option = { value: string; label: string };
const signature = (filters: Filters) =>
  JSON.stringify([
    filters.release,
    filters.from,
    filters.entity,
    filters.category,
    filters.q.trim(),
  ]);

export function ChangesFilters({
  defaultRelease,
  header,
  initialFilters,
  defaultFrom,
  releases,
  entities,
  categories,
}: {
  defaultRelease: string;
  header: ReactNode;
  initialFilters: Filters;
  defaultFrom: string;
  releases: Option[];
  entities: Option[];
  categories: Option[];
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [filters, setFilters] = useState(initialFilters);
  const [previous, setPrevious] = useState(signature(initialFilters));
  const [requested, setRequested] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incoming = signature(initialFilters);
  // Own navigations may finish while the next query is still being typed.
  // Preserve that draft; external URL changes restore the supplied filters.
  if (previous !== incoming) {
    setPrevious(incoming);
    const ownNavigation = requested.indexOf(incoming);
    if (ownNavigation >= 0) setRequested(requested.slice(ownNavigation + 1));
    else {
      setFilters(initialFilters);
      setRequested([]);
    }
  }
  useEffect(() => {
    const restore = () => {
      if (timer.current) clearTimeout(timer.current);
      const params = new URLSearchParams(window.location.search);
      setRequested([]);
      setFilters({
        release: params.get("release") ?? defaultRelease,
        from: params.get("from") ?? defaultFrom,
        entity: params.get("entity") ?? "all",
        category: params.get("category") ?? "all",
        q: params.get("q") ?? "",
      });
    };
    window.addEventListener("popstate", restore);
    return () => {
      window.removeEventListener("popstate", restore);
    };
  }, [defaultFrom, defaultRelease]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const update = (data: FormData, composing: boolean, immediate = false) => {
    const next = Object.fromEntries(
      ["release", "from", "entity", "category", "q"].map((key) => [
        key,
        String(data.get(key) ?? ""),
      ]),
    ) as Filters;
    setFilters(next);
    if (timer.current) clearTimeout(timer.current);
    if (composing) return;
    const navigate = () => {
      const params = new URLSearchParams({
        release: next.release,
        lang: locale,
        from: next.from,
        entity: next.entity,
        category: next.category,
      });
      if (next.q.trim()) params.set("q", next.q.trim());
      if (
        next.from === initialFilters.from &&
        next.release === initialFilters.release
      ) {
        window.history.replaceState(null, "", `/changes?${params}`);
        return;
      }
      setRequested((values) => [...values.slice(-31), signature(next)]);
      startTransition(() =>
        router.replace(`/changes?${params}`, { scroll: false }),
      );
    };
    if (immediate || !next.q) navigate();
    else timer.current = setTimeout(navigate, 80);
  };
  const events = useFilterEvents(update);
  return (
    <CatalogHeader header={header}>
      <form
        action="/changes"
        autoComplete="off"
        onCompositionStart={events.onCompositionStart}
        onCompositionEnd={events.onCompositionEnd}
        onSubmit={events.onSubmit}
        aria-busy={pending}
        className="flex flex-wrap items-center gap-2 text-xs"
      >
        <input type="hidden" name="lang" value={locale} />
        {(
          [
            ["from", t("起始版本"), releases],
            ["release", t("终点版本"), releases],
            ["entity", t("对象"), entities],
            ["category", t("变化"), categories],
          ] as const
        ).map(([name, label, options]) => (
          <CompactSelect
            key={name}
            label={label}
            name={name}
            value={filters[name]}
            onChange={(data, composing) => update(data, composing, true)}
          >
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </CompactSelect>
        ))}
        <label className="relative min-w-0 basis-full sm:basis-60 sm:flex-none">
          <Search
            aria-hidden="true"
            className="absolute left-1.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <span className="sr-only">{t("搜索变化")}</span>
          <input
            type="search"
            name="q"
            value={filters.q}
            onChange={events.onFieldChange}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={100}
            placeholder={t("搜索英雄、技能、物品")}
            className="h-8 w-full min-w-0 bg-transparent pl-7 pr-2 text-xs placeholder:text-[var(--text-muted)]"
          />
        </label>
      </form>
    </CatalogHeader>
  );
}
