import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight } from "lucide-react";
import { AbilityCard } from "@/components/ability-card";
import { AbilityFilterForm } from "@/components/ability-filter-form";
import { EmptyResults, SetupState } from "@/components/system-state";
import { DatasetBadge } from "@/components/ui/dataset-badge";
import { PageHeader } from "@/components/ui/page-header";
import { getAbilityOverview } from "@/server/repositories/abilities";
import {
  canonicalAbilityQuery,
  isCanonicalAbilityQuery,
  parseAbilityFilters,
} from "@/server/services/ability-filters";
import type { SearchParams } from "@/server/services/hero-filters";

export const metadata: Metadata = { title: "Abilities" };
export const dynamic = "force-dynamic";

export default async function AbilitiesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const raw = await searchParams;
  const parsed = parseAbilityFilters(raw);
  if (
    parsed.errors.length === 0 &&
    !isCanonicalAbilityQuery(raw, parsed.filters)
  ) {
    const query = canonicalAbilityQuery(parsed.filters);
    redirect(query ? `/abilities?${query}` : "/abilities");
  }
  let overview: Awaited<ReturnType<typeof getAbilityOverview>>;
  try {
    overview = await getAbilityOverview(
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
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-9 sm:px-7 lg:px-10 lg:py-12">
      <PageHeader
        eyebrow="Ability Registry · complete source set"
        title="当前技能优先，全部定义可审计。"
        description="默认显示 current；可切换到间接、未绑定、模板和废弃定义。数值 ID 只是非唯一映射，internal name 才是版本内身份。"
        aside={
          <DatasetBadge
            clientVersion={meta.clientVersion}
            sourceCommit={meta.sourceCommit}
            warningCount={meta.warningCount}
          />
        }
      />
      <div className="mt-8 space-y-3">
        {parsed.errors.length > 0 && (
          <div className="flex gap-3 border border-[color-mix(in_srgb,var(--status-danger)_35%,transparent)] p-4 text-xs text-[var(--status-danger)]">
            <AlertCircle className="size-4 shrink-0" />
            <div>
              {parsed.errors.map((error) => (
                <p key={error}>{error}</p>
              ))}
            </div>
          </div>
        )}
        <AbilityFilterForm filters={parsed.filters} />
      </div>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
        <p>
          <span className="font-data text-[var(--text-primary)]">
            {overview.total}
          </span>{" "}
          / {meta.totalAbilities} Abilities
        </p>
        <p className="font-data">
          {meta.gateStatus.toUpperCase()} · page {overview.page} /{" "}
          {Math.max(1, overview.pageCount)}
        </p>
      </div>
      {overview.abilities.length ? (
        <div className="catalog-grid mt-6">
          {overview.abilities.map((ability) => (
            <AbilityCard
              key={ability.internalName}
              ability={ability}
              assetVersion={meta.assetDatasetVersionId}
              lang={parsed.filters.lang}
            />
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <EmptyResults />
        </div>
      )}
      {overview.pageCount > 1 && (
        <nav
          aria-label="Ability pages"
          className="mt-8 flex justify-between border-t border-[var(--border-default)] pt-5"
        >
          <PageLink
            direction="previous"
            disabled={overview.page <= 1}
            filters={parsed.filters}
            page={overview.page - 1}
          />
          <PageLink
            direction="next"
            disabled={overview.page >= overview.pageCount}
            filters={parsed.filters}
            page={overview.page + 1}
          />
        </nav>
      )}
    </main>
  );
}

function PageLink({
  direction,
  disabled,
  filters,
  page,
}: {
  direction: "previous" | "next";
  disabled: boolean;
  filters: ReturnType<typeof parseAbilityFilters>["filters"];
  page: number;
}) {
  const content =
    direction === "previous" ? (
      <>
        <ArrowLeft className="size-3.5" /> 上一页
      </>
    ) : (
      <>
        下一页 <ArrowRight className="size-3.5" />
      </>
    );
  if (disabled)
    return (
      <span className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)] opacity-40">
        {content}
      </span>
    );
  const href = `/abilities?${canonicalAbilityQuery({ ...filters, page })}`;
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
    >
      {content}
    </Link>
  );
}
