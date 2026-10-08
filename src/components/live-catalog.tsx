"use client";
import { useLocale } from "@/i18n/provider";
import { diagnosticText } from "@/i18n/diagnostics";
import { useTranslations } from "@/i18n/provider";

import type { ReactNode } from "react";
import type { VersionedListSlice } from "@/domain/infinite-list";
import type { HeroCardRow } from "@/server/repositories/heroes";
import type { AbilityCardRow } from "@/server/repositories/abilities";
import {
  canonicalHeroQuery,
  parseHeroFilters,
  type HeroFilters,
} from "@/server/services/hero-filters";
import {
  canonicalAbilityQuery,
  parseAbilityFilters,
  type AbilityFilters,
} from "@/server/services/ability-filters";
import { CatalogHeader } from "./catalog-header";
import { HeroFilterForm } from "./hero-filter-form";
import { AbilityFilterForm } from "./ability-filter-form";
import { InfiniteHeroCatalog } from "./infinite-hero-catalog";
import { InfiniteAbilityCatalog } from "./infinite-ability-catalog";
import { ValidationErrorList } from "./validation-error-list";
import { useLiveCatalog } from "./use-live-catalog";
export function LiveHeroCatalog({
  initialSlice,
  initialFilters,
  initialErrors,
  total,
  header,
  notice,
}: {
  initialSlice: VersionedListSlice<HeroCardRow>;
  initialFilters: HeroFilters;
  initialErrors: string[];
  total: number;
  header: ReactNode;
  notice?: ReactNode;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const live = useLiveCatalog({
    path: "/heroes",
    localEntity: "heroes",
    initialSlice,
    initialFilters,
    initialErrors,
    parse: parseHeroFilters,
    canonical: canonicalHeroQuery,
  });
  return (
    <>
      {live.validationErrors.length > 0 && (
        <ValidationErrorList errors={live.validationErrors} surface />
      )}
      <CatalogHeader header={header}>
        <HeroFilterForm
          status={
            <CatalogStatus
              count={live.result.slice.total ?? 0}
              total={total}
              unit={t("位英雄")}
              busy={live.busy}
              error={
                live.error === null
                  ? null
                  : diagnosticText(locale, live.error ?? "")
              }
              retry={live.retry}
            />
          }
          filters={live.filters}
          onChange={live.update}
          onClear={live.clear}
        />
      </CatalogHeader>
      {notice}
      <div
        aria-busy={live.busy}
        data-live-results
        data-browser-cache={
          live.result.local && live.result.lang === live.filters.lang
            ? "ready"
            : "loading"
        }
      >
        <InfiniteHeroCatalog
          initialSlice={live.result.slice}
          endpoint={live.endpoint}
          local={live.result.local}
          paused={live.restorePending && !live.result.local}
          lang={live.result.lang}
        />
      </div>
    </>
  );
}
export function LiveAbilityCatalog({
  initialSlice,
  initialFilters,
  initialErrors,
  total,
  heroes,
  header,
}: {
  initialSlice: VersionedListSlice<AbilityCardRow>;
  initialFilters: AbilityFilters;
  initialErrors: string[];
  total: number;
  header: ReactNode;
  heroes: Array<{
    slug: string;
    zhName: string;
    enName: string;
  }>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const live = useLiveCatalog({
    path: "/abilities",
    localEntity: "abilities",
    initialSlice,
    initialFilters,
    initialErrors,
    parse: parseAbilityFilters,
    canonical: canonicalAbilityQuery,
  });
  return (
    <>
      {live.validationErrors.length > 0 && (
        <ValidationErrorList errors={live.validationErrors} surface />
      )}
      <CatalogHeader header={header}>
        <AbilityFilterForm
          status={
            <CatalogStatus
              count={live.result.slice.total ?? 0}
              total={total}
              unit={t("项技能")}
              busy={live.busy}
              error={
                live.error === null
                  ? null
                  : diagnosticText(locale, live.error ?? "")
              }
              retry={live.retry}
            />
          }
          filters={live.filters}
          heroes={heroes}
          onChange={live.update}
          onClear={live.clear}
        />
      </CatalogHeader>
      <div
        aria-busy={live.busy}
        data-live-results
        data-browser-cache={
          live.result.local && live.result.lang === live.filters.lang
            ? "ready"
            : "loading"
        }
      >
        <InfiniteAbilityCatalog
          initialSlice={live.result.slice}
          endpoint={live.endpoint}
          local={live.result.local}
          paused={live.restorePending && !live.result.local}
          lang={live.result.lang}
        />
      </div>
    </>
  );
}
function CatalogStatus({
  count,
  total,
  unit,
  busy,
  error,
  retry,
}: {
  count: number;
  total: number;
  unit: string;
  busy: boolean;
  error: string | null;
  retry: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="whitespace-nowrap"
      >
        <span className="font-data text-[var(--text-primary)]">{count}</span> /{" "}
        {total} {t(unit)}
        {busy && <span className="ml-2">{t("筛选中…")}</span>}
      </p>
      {error ? (
        <p role="alert">
          {diagnosticText(locale, error)}{" "}
          <button onClick={retry} className="underline">
            {t("重试")}
          </button>
        </p>
      ) : null}
    </div>
  );
}
