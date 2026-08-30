import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HeroFilterForm } from "@/components/hero-filter-form";
import { InfiniteHeroCatalog } from "@/components/infinite-hero-catalog";
import { ImportFailureBanner, SetupState } from "@/components/system-state";
import { DatasetBadge } from "@/components/ui/dataset-badge";
import { PageHeader } from "@/components/ui/page-header";
import { ValidationErrorList } from "@/components/validation-error-list";
import { getHeroOverview } from "@/server/repositories/heroes";
import {
  canonicalHeroQuery,
  isCanonicalHeroQuery,
  parseHeroFilters,
  type SearchParams,
} from "@/server/services/hero-filters";

export const metadata: Metadata = { title: "Heroes" };
export const dynamic = "force-dynamic";

export default async function HeroesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const rawSearchParams = await searchParams;
  const parsed = parseHeroFilters(rawSearchParams);
  if (
    parsed.errors.length === 0 &&
    !isCanonicalHeroQuery(rawSearchParams, parsed.filters)
  ) {
    const query = canonicalHeroQuery(parsed.filters);
    redirect(query ? `/heroes?${query}` : "/heroes");
  }

  let overview: Awaited<ReturnType<typeof getHeroOverview>>;
  try {
    overview = await getHeroOverview(
      parsed.errors.length ? null : parsed.filters,
    );
  } catch (error) {
    return (
      <main className="mx-auto min-h-[70vh] max-w-[var(--content-max)] px-4 py-20 sm:px-7 lg:px-10">
        <SetupState
          error={error instanceof Error ? error.message : String(error)}
        />
      </main>
    );
  }

  if (!overview.meta || !overview.slice) {
    return (
      <main className="mx-auto min-h-[70vh] max-w-[var(--content-max)] px-4 py-20 sm:px-7 lg:px-10">
        <SetupState />
      </main>
    );
  }

  const meta = overview.meta;
  const endpointParams = new URLSearchParams(
    canonicalHeroQuery(parsed.filters),
  );
  endpointParams.set("datasetVersionId", meta.datasetVersionId);
  endpointParams.set("assetDatasetVersionId", meta.assetDatasetVersionId);

  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-9 sm:px-7 lg:px-10 lg:py-12">
      <PageHeader
        eyebrow="Hero Catalog · VPK SSOT"
        title="游戏内定义，原样可追溯。"
        description="按 Dota 2 四种主属性浏览当前 Hero。所有规范字段来自固定 VPK 快照；基础数值不等同于一级英雄最终面板。"
        aside={
          <DatasetBadge
            clientVersion={meta.clientVersion}
            sourceCommit={meta.sourceCommit}
            gateStatus={meta.gateStatus}
          />
        }
      />

      <div className="mt-8 space-y-3">
        {overview.latestFailure && (
          <ImportFailureBanner
            stage={overview.latestFailure.stage}
            message={overview.latestFailure.errorSummary}
          />
        )}
        {parsed.errors.length > 0 && (
          <ValidationErrorList errors={parsed.errors} surface />
        )}
        <HeroFilterForm filters={parsed.filters} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
        <p>
          <span className="font-data font-medium text-[var(--text-primary)]">
            {overview.total}
          </span>{" "}
          / {meta.totalHeroes} Heroes
        </p>
        <p className="font-data">
          SourceRevision {meta.sourceRevision} · imported{" "}
          {formatDate(meta.importedAt)}
        </p>
      </div>

      <InfiniteHeroCatalog
        initialSlice={overview.slice}
        endpoint={`/api/catalog/heroes?${endpointParams}`}
        lang={parsed.filters.lang}
      />
    </main>
  );
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}
