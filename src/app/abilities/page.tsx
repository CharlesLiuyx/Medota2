import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AbilityFilterForm } from "@/components/ability-filter-form";
import { InfiniteAbilityCatalog } from "@/components/infinite-ability-catalog";
import { SetupState } from "@/components/system-state";
import { ValidationErrorList } from "@/components/validation-error-list";
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
  if (!overview.meta || !overview.slice) {
    return (
      <main className="mx-auto min-h-[70vh] max-w-[var(--content-max)] px-4 py-20 sm:px-7 lg:px-10">
        <SetupState />
      </main>
    );
  }
  const meta = overview.meta;
  const endpointParams = new URLSearchParams(
    canonicalAbilityQuery(parsed.filters),
  );
  endpointParams.set("datasetVersionId", meta.datasetVersionId);
  endpointParams.set("assetDatasetVersionId", meta.assetDatasetVersionId);
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
            gateStatus={meta.gateStatus}
          />
        }
      />
      <div className="mt-8 space-y-3">
        {parsed.errors.length > 0 && (
          <ValidationErrorList errors={parsed.errors} />
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
          {meta.gateStatus.toUpperCase()} · continuous stream
        </p>
      </div>
      <InfiniteAbilityCatalog
        initialSlice={overview.slice}
        endpoint={`/api/catalog/abilities?${endpointParams}`}
        lang={parsed.filters.lang}
      />
    </main>
  );
}
