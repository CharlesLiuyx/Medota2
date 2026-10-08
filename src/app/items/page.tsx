import { PageInfoTooltip } from "@/components/ui/page-info-tooltip";
import { getTranslations } from "@/i18n/server";
import { LocalizedText } from "@/i18n/provider";
import { resolvePageRelease } from "@/server/services/releases";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import type { Metadata } from "next";
import { pinyin } from "pinyin-pro";
import { ItemCatalog } from "@/components/item-catalog";
import { getItemOverview } from "@/server/repositories/items";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("物品") };
}
export const dynamic = "force-dynamic";
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<import("@/server/services/hero-filters").SearchParams>;
}) {
  const t = await getTranslations();
  const selected = await resolvePageRelease("/items", await searchParams);
  if (selected && !selected.catalogId)
    return <MissingReleaseCoverage kind={t("物品")} />;
  const { meta, snapshot, imageVersion } = await getItemOverview(
    selected?.catalogId ?? undefined,
  );
  const items = snapshot?.items.map((item) => {
    const syllables = pinyin(item.zhName, {
      toneType: "none",
      type: "array",
      v: true,
    });
    return {
      ...item,
      searchText: [
        item.internalName,
        item.zhName,
        item.enName,
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
      {items ? (
        <ItemCatalog
          header={
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-wide">
                <LocalizedText>物品图鉴</LocalizedText>
              </h1>
              <PageInfoTooltip label={t("物品图鉴")}>
                <p>
                  {t(
                    "装备、消耗品、中立物品、附魔与合成图纸。资料也含历史及活动定义，不代表全部可在当前对局购买或获得。",
                  )}
                </p>
              </PageInfoTooltip>
            </div>
          }
          items={items}
          version={meta!.datasetVersionId}
          imageVersion={imageVersion}
        />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-wide">
              <LocalizedText>物品图鉴</LocalizedText>
            </h1>
            <PageInfoTooltip label={t("物品图鉴")}>
              <p>
                {t(
                  "装备、消耗品、中立物品、附魔与合成图纸。资料也含历史及活动定义，不代表全部可在当前对局购买或获得。",
                )}
              </p>
            </PageInfoTooltip>
          </div>
          <p
            role="status"
            className="py-16 text-center text-sm text-[var(--text-muted)]"
          >
            {t(
              "该版本的物品资料尚未接入，请配置与收录版本匹配的游戏来源后重试。",
            )}
          </p>
        </>
      )}
    </main>
  );
}
