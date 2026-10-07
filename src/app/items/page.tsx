import { getTranslations } from "@/i18n/server";
import { LocalizedText } from "@/i18n/provider";
import { resolvePageRelease } from "@/server/services/releases";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import type { Metadata } from "next";
import { pinyin } from "pinyin-pro";
import { ItemCatalog } from "@/components/item-catalog";
import { DatasetBadge } from "@/components/ui/dataset-badge";
import { getItemOverview } from "@/server/repositories/items";
import { getGameplayVersion } from "@/server/services/gameplay-version";
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-wide">
          <LocalizedText>物品图鉴</LocalizedText>
        </h1>
        {meta && (
          <DatasetBadge
            clientVersion={meta.clientVersion}
            sourceCommit={meta.sourceCommit}
            gateStatus={meta.gateStatus}
            gameplayVersion={await getGameplayVersion(
              meta.datasetVersionId,
              meta.sourceCommit,
            )}
          />
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-muted)]">
        {t(
          "装备、消耗品、中立物品、附魔与合成图纸。资料也含历史及活动定义，不代表全部可在当前对局购买或获得。",
        )}
      </p>
      {items ? (
        <ItemCatalog
          items={items}
          version={meta!.datasetVersionId}
          imageVersion={imageVersion}
        />
      ) : (
        <p
          role="status"
          className="py-16 text-center text-sm text-[var(--text-muted)]"
        >
          {t(
            "该版本的物品资料尚未接入，请配置与收录版本匹配的游戏来源后重试。",
          )}
        </p>
      )}
    </main>
  );
}
