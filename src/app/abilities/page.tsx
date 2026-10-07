import { gameLocale } from "@/i18n/config";
import { getTranslations } from "@/i18n/server";
import { getRequestLocale } from "@/i18n/server";
import { withLocale } from "@/i18n/locale";
import { LocalizedText } from "@/i18n/provider";
import { resolvePageRelease } from "@/server/services/releases";
import { withRelease } from "@/domain/releases";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import { getHeroChoices } from "@/server/repositories/heroes";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LiveAbilityCatalog } from "@/components/live-catalog";
import { SetupState } from "@/components/system-state";
import { DatasetBadge } from "@/components/ui/dataset-badge";
import { getGameplayVersion } from "@/server/services/gameplay-version";
import { getAbilityOverview } from "@/server/repositories/abilities";
import {
  canonicalAbilityQuery,
  isCanonicalAbilityQuery,
  parseAbilityFilters,
} from "@/server/services/ability-filters";
import type { SearchParams } from "@/server/services/hero-filters";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("技能") };
}
export const dynamic = "force-dynamic";
export default async function AbilitiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const t = await getTranslations();
  const locale = await getRequestLocale();
  const raw = await searchParams;
  const selected = await resolvePageRelease("/abilities", raw);
  if (selected && !selected.catalogId)
    return <MissingReleaseCoverage kind={t("技能")} />;
  const filterParams = { ...raw };
  delete filterParams.release;
  filterParams.lang = gameLocale(locale);
  // The default locale may be explicit in a shared global-navigation URL.
  if (filterParams.lang === "zh-CN") delete filterParams.lang;
  const parsed = parseAbilityFilters(filterParams);
  if (
    parsed.errors.length === 0 &&
    !isCanonicalAbilityQuery(filterParams, parsed.filters)
  ) {
    const query = canonicalAbilityQuery(parsed.filters);
    redirect(
      withLocale(
        withRelease(
          query ? `/abilities?${query}` : "/abilities",
          selected?.id ?? null,
        ),
        locale,
        true,
      ),
    );
  }
  let overview: Awaited<ReturnType<typeof getAbilityOverview>>;
  try {
    overview = await getAbilityOverview(
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
  const [gameplayVersion, heroes] = await Promise.all([
    getGameplayVersion(meta.datasetVersionId, meta.sourceCommit),
    getHeroChoices(meta.datasetVersionId),
  ]);
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold tracking-wide">
          <LocalizedText>技能图鉴</LocalizedText>
        </h1>
        <DatasetBadge
          gameplayVersion={gameplayVersion}
          clientVersion={meta.clientVersion}
          sourceCommit={meta.sourceCommit}
          gateStatus={meta.gateStatus}
        />
      </div>
      <LiveAbilityCatalog
        key={`${meta.datasetVersionId}:${meta.assetDatasetVersionId}:${canonicalAbilityQuery(parsed.filters)}`}
        initialSlice={overview.slice}
        initialFilters={parsed.filters}
        initialErrors={parsed.errors}
        total={meta.totalAbilities}
        heroes={heroes}
      />
    </main>
  );
}
