import { gameLocale } from "@/i18n/config";
import { getTranslations } from "@/i18n/server";
import { getRequestLocale } from "@/i18n/server";
import { withLocale } from "@/i18n/locale";
import { resolvePageRelease } from "@/server/services/releases";
import { withRelease } from "@/domain/releases";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LiveHeroCatalog } from "@/components/live-catalog";
import { ImportFailureBanner, SetupState } from "@/components/system-state";
import { getHeroOverview } from "@/server/repositories/heroes";
import {
  canonicalHeroQuery,
  isCanonicalHeroQuery,
  parseHeroFilters,
  type SearchParams,
} from "@/server/services/hero-filters";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("英雄") };
}
export const dynamic = "force-dynamic";
export default async function HeroesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const t = await getTranslations();
  const locale = await getRequestLocale();
  const rawSearchParams = await searchParams;
  const selected = await resolvePageRelease("/heroes", rawSearchParams);
  if (selected && !selected.catalogId)
    return <MissingReleaseCoverage kind={t("英雄")} />;
  const filterParams = { ...rawSearchParams };
  delete filterParams.release;
  filterParams.lang = gameLocale(locale);
  // The default locale may be explicit in a shared global-navigation URL.
  if (filterParams.lang === "zh-CN") delete filterParams.lang;
  const parsed = parseHeroFilters(filterParams);
  if (
    parsed.errors.length === 0 &&
    !isCanonicalHeroQuery(filterParams, parsed.filters)
  ) {
    const query = canonicalHeroQuery(parsed.filters);
    redirect(
      withLocale(
        withRelease(
          query ? `/heroes?${query}` : "/heroes",
          selected?.id ?? null,
        ),
        locale,
        true,
      ),
    );
  }
  let overview: Awaited<ReturnType<typeof getHeroOverview>>;
  try {
    overview = await getHeroOverview(
      parsed.errors.length ? null : parsed.filters,
      selected?.catalogId ?? undefined,
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
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-4 sm:px-6">
      <LiveHeroCatalog
        header={
          <h1 className="text-xl font-semibold tracking-wide">
            {t("英雄图鉴")}
          </h1>
        }
        notice={
          overview.latestFailure && (
            <ImportFailureBanner
              stage={overview.latestFailure.stage}
              message={overview.latestFailure.errorSummary}
            />
          )
        }
        key={`${meta.datasetVersionId}:${meta.assetDatasetVersionId}:${canonicalHeroQuery(parsed.filters)}`}
        initialSlice={overview.slice}
        initialFilters={parsed.filters}
        initialErrors={parsed.errors}
        total={meta.totalHeroes}
      />
    </main>
  );
}
