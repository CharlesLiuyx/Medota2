"use client";
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
  updatedAt,
}: {
  initialSlice: VersionedListSlice<HeroCardRow>;
  initialFilters: HeroFilters;
  initialErrors: string[];
  total: number;
  updatedAt: string;
}) {
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
      <div className="mt-3">
        <HeroFilterForm
          filters={live.filters}
          onChange={live.update}
          onClear={live.clear}
        />
      </div>
      <CatalogStatus
        count={live.result.slice.total ?? 0}
        total={total}
        unit="位英雄"
        busy={live.busy}
        error={live.error}
        retry={live.retry}
      >
        <span data-catalog-updated-at>资料更新于 {updatedAt}</span>
      </CatalogStatus>
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
}: {
  initialSlice: VersionedListSlice<AbilityCardRow>;
  initialFilters: AbilityFilters;
  initialErrors: string[];
  total: number;
  heroes: Array<{ slug: string; zhName: string; enName: string }>;
}) {
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
      <div className="mt-3">
        <AbilityFilterForm
          filters={live.filters}
          heroes={heroes}
          onChange={live.update}
          onClear={live.clear}
        />
      </div>
      <CatalogStatus
        count={live.result.slice.total ?? 0}
        total={total}
        unit="项技能"
        busy={live.busy}
        error={live.error}
        retry={live.retry}
      >
        向下浏览更多技能
      </CatalogStatus>
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
  children,
}: {
  count: number;
  total: number;
  unit: string;
  busy: boolean;
  error: string | null;
  retry: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
      <p role="status" aria-live="polite" aria-atomic="true">
        <span className="font-data text-[var(--text-primary)]">{count}</span> /{" "}
        {total} {unit}
        {busy && <span className="ml-2">筛选中…</span>}
      </p>
      {error ? (
        <p role="alert">
          {error}{" "}
          <button onClick={retry} className="underline">
            重试
          </button>
        </p>
      ) : (
        <p className="font-data">{children}</p>
      )}
    </div>
  );
}
