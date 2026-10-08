import { releaseLabel } from "@/presentation/releases";
import { diagnosticText } from "@/i18n/diagnostics";
import { LocalizedText } from "@/i18n/provider";
import { getTranslations } from "@/i18n/server";

import { getRequestLocale } from "@/i18n/server";

import { canonicalReleaseId } from "@/domain/releases";
import { ChangesAudit } from "@/components/changes-audit";
import { ChangesResults } from "@/components/changes-results";
import { changeTableGroups } from "@/presentation/changes-table";
import { ChangesFilters } from "@/components/changes-filters";
import { PageInfoTooltip } from "@/components/ui/page-info-tooltip";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ENTITY_KINDS } from "@/domain/entity-version-diff";
import {
  getReleaseIndex,
  resolvePageRelease,
} from "@/server/services/releases";
import { getEntityVersionDiff } from "@/server/services/entity-version-diff";
import { getReleaseChangesView } from "@/server/services/release-changes";
import { isEnvironmentConnectionError } from "@/server/environment/policy";
import { DataUnavailable } from "@/components/data-unavailable";
import type { SearchParams } from "@/server/services/hero-filters";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("版本变化") };
}
export const dynamic = "force-dynamic";
const kindNames = {
  hero: "英雄",
  ability: "技能",
  item: "物品",
  facet: "命石",
  unit: "单位",
  map_object: "地图对象",
  map_region: "地图区域",
  relation: "关系",
  mechanism: "机制",
  localization: "文字说明",
  asset_binding: "图片",
  source_structure: "原始资料",
};
const categories = {
  buff: "增强",
  nerf: "削弱",
  neutral: "持平",
  entity: "新增或移除",
  property: "属性",
  relation: "关系",
  mechanism: "机制",
  source_structure: "原始资料",
};
export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  try {
    return await renderChangesPage(searchParams);
  } catch (error) {
    if (!isEnvironmentConnectionError(error)) throw error;
    console.warn("[changes] data unavailable", error.connectionFailure);
    return <DataUnavailable />;
  }
}

async function renderChangesPage(searchParams: Promise<SearchParams>) {
  const t = await getTranslations();
  const locale = await getRequestLocale();
  const params = await searchParams;
  const selected = await resolvePageRelease("/changes", params);
  const index = await getReleaseIndex();
  if (!selected) return <main className="p-8">{t("版本资料尚未收录。")}</main>;
  const read = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) notFound();
    return value;
  };
  const defaultRelease = index.defaultRelease ?? selected.id;
  const latestIndex = index.releases.findIndex((r) => r.id === defaultRelease);
  const defaultFrom = index.releases[latestIndex + 1]?.id ?? defaultRelease;
  const fromId =
    (read("from") ? canonicalReleaseId(index, read("from")!) : undefined) ??
    defaultFrom;
  const from = index.releases.find((r) => r.id === fromId);
  if (!from) notFound();
  const kind = read("entity") ?? "all",
    category = read("category") ?? "all";
  if (
    kind !== "all" &&
    kind !== "item" &&
    kind !== "other" &&
    !(ENTITY_KINDS as readonly string[]).includes(kind)
  )
    notFound();
  if (category !== "all" && !Object.hasOwn(categories, category)) notFound();
  const diff = await getEntityVersionDiff(from.id, selected.id);
  const view = await getReleaseChangesView(
    from,
    selected,
    diff.changes,
    locale,
  );
  const tableGroups = changeTableGroups(view.groups, locale);
  const beforeLabel = from.patch ?? t("起始版本"),
    afterLabel = selected.patch ?? t("所选版本");
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-5 sm:px-6">
      <ChangesFilters
        header={
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">
              <LocalizedText>版本变化</LocalizedText>
            </h1>
            <PageInfoTooltip label={t("版本变化")}>
              <p>
                {t("按英雄、技能和物品查看前后变化。数值按技能等级顺序排列。")}
              </p>
            </PageInfoTooltip>
          </div>
        }
        key={`${selected.id}:${locale}`}
        defaultRelease={defaultRelease}
        defaultFrom={defaultFrom}
        initialFilters={{
          release: selected.id,
          from: fromId,
          entity: kind,
          category,
          q: read("q") ?? "",
        }}
        releases={index.releases.map((r) => ({
          value: r.id,
          label: releaseLabel(r, locale),
        }))}
        entities={[
          { value: "all", label: t("全部") },
          ...(["mechanism", "hero", "item"] as const).map((k) => ({
            value: k,
            label: t(kindNames[k]),
          })),
          { value: "other", label: t("其他") },
        ]}
        categories={[
          { value: "all", label: t("全部") },
          ...Object.entries(categories)
            .filter(([value]) => ["buff", "nerf", "neutral"].includes(value))
            .map(([value, label]) => ({
              value,
              label: t(label),
            })),
        ]}
      />
      <ChangesResults
        groups={tableGroups}
        references={view.references}
        identity={`${from.id}:${selected.id}:${locale}`}
        before={beforeLabel}
        after={afterLabel}
        sourceUrl={view.patch?.source.page}
        sameVersion={from.id === selected.id}
        noChanges={diff.changes.length === 0}
        audit={
          <PageInfoTooltip label={t("比较范围与来源")}>
            <p>{t("前后值来自所选的两个完整版本。")}</p>
            {view.patch && (
              <a
                className="underline"
                href={view.patch.source.page}
                target="_blank"
                rel="noreferrer"
              >
                {t("{value0} 官方更新说明 ↗", { value0: view.patch.toPatch })}
              </a>
            )}
            <p>{t("地图身份、完整脚本及部分规则仍待核验。")}</p>
            <p>
              {t(
                "对象和改动项按最大影响排序，相同改动项连续排列，项内按方向及影响排序；持平中的问号表示收益方向待判断。",
              )}
            </p>
            <ul className="mt-2 space-y-1">
              {diff.coverage.map((c) => (
                <li key={c.entityType}>
                  {t(kindNames[c.entityType])} ·{" "}
                  {t(
                    c.status === "comparable"
                      ? "可比较"
                      : c.status === "partial"
                        ? "部分可比较"
                        : "无法比较",
                  )}
                  {c.reason ? ` · ${diagnosticText(locale, c.reason)}` : ""}
                </li>
              ))}
            </ul>
            {diff.implementationChanges && (
              <details>
                <summary>{t("资料解析方式的变化")}</summary>
                <pre className="whitespace-pre-wrap break-all text-[10px]">
                  {JSON.stringify(diff.implementationChanges, null, 2)}
                </pre>
              </details>
            )}
            <ChangesAudit
              technical={view.technical}
              unresolved={diff.unresolved}
            />
          </PageInfoTooltip>
        }
      />
    </main>
  );
}
