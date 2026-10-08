import {
  attributeSlice,
  parseAttributeQuery,
} from "@/server/services/attribute-catalog";
import { getTranslations } from "@/i18n/server";
import { resolvePageRelease } from "@/server/services/releases";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import { getAttributeOverview } from "@/server/repositories/attributes";
import { AttributeCatalog } from "@/components/attribute-catalog";
import { PageInfoTooltip } from "@/components/ui/page-info-tooltip";
export const dynamic = "force-dynamic";
export async function generateMetadata() {
  const t = await getTranslations();
  return { title: t("属性图鉴") };
}
export default async function AttributesPage({
  searchParams,
}: {
  searchParams: Promise<import("@/server/services/hero-filters").SearchParams>;
}) {
  const t = await getTranslations();
  const query = await searchParams;
  const selected = await resolvePageRelease("/attributes", query);
  if (selected && !selected.catalogId)
    return <MissingReleaseCoverage kind={t("属性")} />;
  const { meta, snapshot } = await getAttributeOverview(
    selected?.catalogId ?? undefined,
  );
  if (!meta || !snapshot) return <MissingReleaseCoverage kind={t("属性")} />;
  return (
    <main className="mx-auto min-h-[70vh] max-w-[var(--content-max)] px-4 py-4 sm:px-6">
      <AttributeCatalog
        key={meta.datasetVersionId}
        header={
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{t("属性图鉴")}</h1>
            <PageInfoTooltip label={t("属性图鉴")}>
              <p>
                {t(
                  "从英雄、技能、单位和物品的数值进入机制。通用属性共用身份，专属参数保留所属对象；解释与关联跟随所选版本。",
                )}
              </p>
            </PageInfoTooltip>
          </div>
        }
        notice={
          snapshot.missing.length > 0 && (
            <p role="status">
              {t("部分关联来源缺失：{value0}", {
                value0: snapshot.missing.map((s) => t(s)).join("、"),
              })}
            </p>
          )
        }
        initialSlice={attributeSlice(
          snapshot.summaries,
          meta.datasetVersionId,
          parseAttributeQuery(
            new URLSearchParams(
              Object.entries(query).flatMap(([k, v]) =>
                v === undefined
                  ? []
                  : (Array.isArray(v) ? v : [v]).map((s) => [k, s]),
              ),
            ),
          ),
        )}
        totalAttributes={snapshot.summaries.length}
        version={meta.datasetVersionId}
      />
    </main>
  );
}
