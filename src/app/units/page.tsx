import type { Metadata } from "next";
import { pinyin } from "pinyin-pro";
import { UnitCatalog } from "@/components/unit-catalog";
import { DatasetBadge } from "@/components/ui/dataset-badge";
import { getUnitOverview, getUnitPortraits } from "@/server/repositories/units";
import { getGameplayVersion } from "@/server/services/gameplay-version";
export const metadata: Metadata = { title: "单位" };
export const dynamic = "force-dynamic";
export default async function UnitsPage() {
  const { meta, snapshot } = await getUnitOverview();
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold tracking-wide">单位图鉴</h1>
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
        兵线、野怪、建筑、守卫、信使与召唤单位。收录版本中的基础定义，也含活动和辅助对象；不代表均会在当前对局出现。
      </p>
      {units ? (
        <UnitCatalog units={units} />
      ) : (
        <p
          role="status"
          className="py-16 text-center text-sm text-[var(--text-muted)]"
        >
          该版本的单位资料尚未接入，请配置与收录版本匹配的游戏来源后重试。
        </p>
      )}
    </main>
  );
}
