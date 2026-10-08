import { PageInfoTooltip } from "@/components/ui/page-info-tooltip";
import { getTranslations } from "@/i18n/server";
import { LocalizedText } from "@/i18n/provider";
import { resolvePageRelease } from "@/server/services/releases";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import type { Metadata } from "next";
import { pinyin } from "pinyin-pro";
import { UnitCatalog } from "@/components/unit-catalog";
import { getUnitOverview, getUnitPortraits } from "@/server/repositories/units";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("单位") };
}
export const dynamic = "force-dynamic";
export default async function UnitsPage({
  searchParams,
}: {
  searchParams: Promise<import("@/server/services/hero-filters").SearchParams>;
}) {
  const t = await getTranslations();
  const selected = await resolvePageRelease("/units", await searchParams);
  if (selected && !selected.catalogId)
    return <MissingReleaseCoverage kind={t("单位")} />;
  const { meta, snapshot } = await getUnitOverview(
    selected?.catalogId ?? undefined,
  );
  const portraits = meta ? await getUnitPortraits(meta.datasetVersionId) : {};
  const units = snapshot?.units.map((unit) => {
    const syllables = pinyin(unit.zhName, {
      toneType: "none",
      type: "array",
      v: true,
    });
    return {
      ...unit,
      portrait: portraits[unit.internalName],
      searchText: [
        unit.internalName,
        unit.zhName,
        unit.enName,
        syllables.join(""),
        syllables.map((s) => s[0]).join(""),
      ]
        .join("|")
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s_'’\-]+/gu, ""),
    };
  });
  return (
    <main className="mx-auto min-h-[70vh] max-w-[var(--content-max)] px-4 py-4 sm:px-6">
      {units ? (
        <UnitCatalog
          units={units}
          header={
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-wide">
                <LocalizedText>单位图鉴</LocalizedText>
              </h1>
              <PageInfoTooltip label={t("单位图鉴")}>
                <p>
                  {t(
                    "兵线、野怪、建筑、守卫、信使与召唤单位。收录版本中的基础定义，也含活动和辅助对象；不代表均会在当前对局出现。",
                  )}
                </p>
              </PageInfoTooltip>
            </div>
          }
        />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-wide">
              <LocalizedText>单位图鉴</LocalizedText>
            </h1>
            <PageInfoTooltip label={t("单位图鉴")}>
              <p>
                {t(
                  "兵线、野怪、建筑、守卫、信使与召唤单位。收录版本中的基础定义，也含活动和辅助对象；不代表均会在当前对局出现。",
                )}
              </p>
            </PageInfoTooltip>
          </div>
          <p
            role="status"
            className="py-16 text-center text-sm text-[var(--text-muted)]"
          >
            {t(
              "该版本的单位资料尚未接入，请配置与收录版本匹配的游戏来源后重试。",
            )}
          </p>
        </>
      )}
    </main>
  );
}
