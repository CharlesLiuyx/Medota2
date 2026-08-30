import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { HeroCard } from "@/components/hero-card";
import { HeroFilterForm } from "@/components/hero-filter-form";
import {
  EmptyResults,
  ImportFailureBanner,
  SetupState,
} from "@/components/system-state";
import { DatasetBadge } from "@/components/ui/dataset-badge";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { PRIMARY_ATTRIBUTES, type PrimaryAttribute } from "@/domain/heroes";
import { getHeroOverview } from "@/server/repositories/heroes";
import {
  canonicalHeroQuery,
  isCanonicalHeroQuery,
  parseHeroFilters,
  type SearchParams,
} from "@/server/services/hero-filters";

export const metadata: Metadata = { title: "Heroes" };
export const dynamic = "force-dynamic";

const attributeNames: Record<PrimaryAttribute, { zh: string; en: string }> = {
  strength: { zh: "力量", en: "Strength" },
  agility: { zh: "敏捷", en: "Agility" },
  intelligence: { zh: "智力", en: "Intelligence" },
  universal: { zh: "全才", en: "Universal" },
};

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

  if (!overview.meta) {
    return (
      <main className="mx-auto min-h-[70vh] max-w-[var(--content-max)] px-4 py-20 sm:px-7 lg:px-10">
        <SetupState />
      </main>
    );
  }

  const meta = overview.meta;
  const groups = PRIMARY_ATTRIBUTES.map((attribute) => ({
    attribute,
    heroes: overview.heroes.filter(
      (hero) => hero.primaryAttribute === attribute,
    ),
  })).filter((group) => group.heroes.length > 0);

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
            warningCount={meta.warningCount}
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
          <div className="flex items-start gap-3 border border-[color-mix(in_srgb,var(--status-danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-danger)_7%,transparent)] px-4 py-3 text-xs text-[var(--status-danger)]">
            <AlertCircle className="size-4 shrink-0" />
            <div>
              {parsed.errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          </div>
        )}
        <HeroFilterForm filters={parsed.filters} />
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
        <p>
          <span className="font-data font-medium text-[var(--text-primary)]">
            {overview.heroes.length}
          </span>{" "}
          / {meta.totalHeroes} Heroes
        </p>
        <p className="font-data">
          SourceRevision {meta.sourceRevision} · imported{" "}
          {formatDate(meta.importedAt)}
        </p>
      </div>

      {groups.length > 0 ? (
        <div className="mt-9 space-y-11">
          {groups.map(({ attribute, heroes }) => (
            <section key={attribute} aria-labelledby={`${attribute}-heroes`}>
              <div id={`${attribute}-heroes`}>
                <SectionHeading
                  eyebrow={attributeNames[attribute].en}
                  title={attributeNames[attribute].zh}
                  count={heroes.length}
                  tone={attribute}
                />
              </div>
              <div className="catalog-grid mt-4">
                {heroes.map((hero) => (
                  <HeroCard
                    key={hero.heroId}
                    hero={hero}
                    lang={parsed.filters.lang}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="mt-5">
          <EmptyResults />
        </div>
      )}
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
