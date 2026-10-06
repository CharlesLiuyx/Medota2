import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AbilityTooltip } from "@/components/ability-tooltip";
import { getAbilityByInternalName } from "@/server/repositories/abilities";
import { getGameLocalization } from "@/server/services/game-localization";
import { displayName, relationLabel, textValues } from "@/presentation/dota";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{ "internal-name": string }>;
  searchParams: Promise<{ lang?: string }>;
};
export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const lang = (await searchParams).lang === "en" ? "en" : "zh-CN";
  const detail = await getAbilityByInternalName(
    (await params)["internal-name"],
    lang,
  );
  return {
    title: `${displayName(detail?.localizations[0]?.display_name, "技能详情", detail ? textValues(detail.values, detail.ability) : {})} · 技能`,
  };
}
export default async function AbilityDetailPage({
  params,
  searchParams,
}: Props) {
  const internalName = (await params)["internal-name"];
  if (!/^[a-z0-9_]+$/u.test(internalName)) notFound();
  const lang = (await searchParams).lang === "en" ? "en" : "zh-CN";
  const detail = await getAbilityByInternalName(internalName, lang);
  if (!detail) notFound();
  const tokens = await getGameLocalization(
    detail.meta.datasetVersionId,
    detail.meta.sourceCommit,
    lang,
  );
  const preferred = detail.localizations.find((l) => l.locale === lang);
  const english = detail.localizations.find((l) => l.locale === "en");
  const localized = {
    display_name: preferred?.display_name || english?.display_name || null,
    description: preferred?.description || english?.description || null,
    lore: preferred?.lore || english?.lore,
    scepter_description:
      preferred?.scepter_description || english?.scepter_description,
    shard_description:
      preferred?.shard_description || english?.shard_description,
  };
  const owners = [
    ...new Map(
      detail.bindings.filter((b) => b.is_current).map((b) => [b.hero_id, b]),
    ).values(),
  ];
  return (
    <main className="ability-detail mx-auto max-w-[var(--content-max)] px-4 py-3 sm:px-6">
      <div className="mb-3 flex justify-between text-xs text-[var(--text-secondary)]">
        <Link href="/abilities">← 全部技能</Link>
        <Link
          href={`/abilities/${internalName}${lang === "en" ? "" : "?lang=en"}`}
        >
          {lang === "en" ? "简体中文" : "English"}
        </Link>
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <AbilityTooltip
          ability={{
            ...detail.ability,
            source_definition: detail.sources.at(-1)?.resolved_definition,
            ...localized,
            values: detail.values,
          }}
          tokens={tokens}
          assetVersion={detail.meta.assetDatasetVersionId}
          lang={lang}
          heading
        />
        <aside className="dota-panel">
          <h2 className="mb-2 text-sm font-medium text-[#d8c49a]">所属英雄</h2>
          {owners.length ? (
            owners.map((owner) => (
              <Link
                className="mb-1 block p-2 text-sm hover:bg-white/5"
                key={owner.hero_id}
                href={`/heroes/${owner.slug}${lang === "en" ? "?lang=en" : ""}`}
              >
                <strong>
                  {displayName(owner.hero_name, "英雄名称待补充")}
                </strong>
                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                  {relationLabel(owner.relation_kind)} →
                </span>
              </Link>
            ))
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              此技能暂未关联可选英雄。
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
            技能数值以当前收录的游戏版本为准。天赋、命石和升级可能改变技能效果。
          </p>
        </aside>
      </div>
    </main>
  );
}
