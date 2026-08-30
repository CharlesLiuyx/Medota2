import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  AlertCircle,
  Braces,
  Clock3,
  Database,
  ShieldCheck,
} from "lucide-react";
import { HeroCard } from "@/components/hero-card";
import { HeroFilterForm } from "@/components/hero-filter-form";
import {
  EmptyResults,
  ImportFailureBanner,
  SetupState,
} from "@/components/system-state";
import { getHeroOverview } from "@/server/repositories/heroes";
import {
  canonicalHeroQuery,
  isCanonicalHeroQuery,
  parseHeroFilters,
  type SearchParams,
} from "@/server/services/hero-filters";

export const metadata: Metadata = { title: "英雄元数据" };
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
      <main className="mx-auto min-h-[70vh] max-w-[1480px] px-5 py-20 sm:px-8 lg:px-10">
        <SetupState
          error={error instanceof Error ? error.message : String(error)}
        />
      </main>
    );
  }
  if (!overview.meta) {
    return (
      <main className="mx-auto min-h-[70vh] max-w-[1480px] px-5 py-20 sm:px-8 lg:px-10">
        <SetupState />
      </main>
    );
  }

  const meta = overview.meta;
  return (
    <main className="mx-auto max-w-[1480px] px-5 py-10 sm:px-8 lg:px-10 lg:py-14">
      <section className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-[#db694d]">
            Hero metadata · MVP 01
          </p>
          <h1 className="mt-3 max-w-3xl text-balance text-4xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
            游戏内定义，<span className="text-zinc-500">原样可追溯。</span>
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-500">
            所有规范字段来自固定 VPK
            快照。展示的是继承后的基础定义，不是一级英雄最终面板数值。
          </p>
        </div>
        <div className="grid grid-cols-2 gap-px border border-white/9 bg-white/9 sm:grid-cols-4 lg:w-[590px]">
          <MetaCell
            icon={<Database />}
            label="英雄"
            value={String(meta.totalHeroes)}
          />
          <MetaCell
            icon={<Braces />}
            label="Client"
            value={meta.clientVersion}
          />
          <MetaCell
            icon={<ShieldCheck />}
            label="Source Rev"
            value={meta.sourceRevision}
          />
          <MetaCell
            icon={<Clock3 />}
            label="导入"
            value={formatDate(meta.importedAt)}
          />
        </div>
      </section>

      <div className="mt-9 space-y-3">
        {overview.latestFailure && (
          <ImportFailureBanner
            stage={overview.latestFailure.stage}
            message={overview.latestFailure.errorSummary}
          />
        )}
        {parsed.errors.length > 0 && (
          <div className="flex items-start gap-3 border border-red-400/20 bg-red-400/5 px-4 py-3 text-xs text-red-200">
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

      <div className="mt-7 flex items-center justify-between text-xs text-zinc-500">
        <p>
          <span className="font-medium text-zinc-200">
            {overview.heroes.length}
          </span>{" "}
          / {meta.totalHeroes} 位英雄
        </p>
        <p className="flex items-center gap-2">
          <span
            className={`size-1.5 rounded-full ${meta.warningCount ? "bg-amber-400" : "bg-emerald-400"}`}
          />
          {meta.warningCount} 个 active dataset warning ·{" "}
          {meta.sourceCommit.slice(0, 8)}
        </p>
      </div>

      <section className="mt-4">
        {overview.heroes.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {overview.heroes.map((hero) => (
              <HeroCard key={hero.heroId} hero={hero} />
            ))}
          </div>
        ) : (
          <EmptyResults />
        )}
      </section>
    </main>
  );
}

function MetaCell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-[#111317] px-4 py-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-600 [&>svg]:size-3">
        {icon}
        {label}
      </div>
      <p className="mt-2 truncate text-sm font-medium tabular-nums text-zinc-200">
        {value}
      </p>
    </div>
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
