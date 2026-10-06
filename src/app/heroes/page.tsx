import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LiveHeroCatalog } from "@/components/live-catalog";
import { ImportFailureBanner, SetupState } from "@/components/system-state";
import { DatasetBadge } from "@/components/ui/dataset-badge";
import { getGameplayVersion } from "@/server/services/gameplay-version";
import { getHeroOverview } from "@/server/repositories/heroes";
import {
  canonicalHeroQuery,
  isCanonicalHeroQuery,
  parseHeroFilters,
  type SearchParams,
} from "@/server/services/hero-filters";

export const metadata: Metadata = { title: "英雄" };
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
  const gameplayVersion = await getGameplayVersion(
    meta.datasetVersionId,
    meta.sourceCommit,
  );
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold tracking-wide">英雄图鉴</h1>
        <DatasetBadge
          clientVersion={meta.clientVersion}
          sourceCommit={meta.sourceCommit}
          gateStatus={meta.gateStatus}
          gameplayVersion={gameplayVersion}
        />
      </div>

      <div className="mt-3 space-y-2">
        {overview.latestFailure && (
          <ImportFailureBanner
            stage={overview.latestFailure.stage}
            message={overview.latestFailure.errorSummary}
          />
        )}
      </div>

      <LiveHeroCatalog
        key={`${meta.datasetVersionId}:${meta.assetDatasetVersionId}:${canonicalHeroQuery(parsed.filters)}`}
        initialSlice={overview.slice}
        initialFilters={parsed.filters}
        initialErrors={parsed.errors}
        total={meta.totalHeroes}
        updatedAt={formatDate(meta.importedAt)}
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
