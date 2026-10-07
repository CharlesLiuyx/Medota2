import { OwnerAttributeList } from "@/components/owner-attribute-list";
import { SourceLanguageNotice } from "@/i18n/provider";
import { getRequestGameLocale } from "@/i18n/server";
import { getTranslations } from "@/i18n/server";
import { getRequestLocale } from "@/i18n/server";
import { resolvePageRelease } from "@/server/services/releases";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import type { Metadata } from "next";
import Link from "@/components/version-link";
import { notFound } from "next/navigation";
import { AbilityTooltip } from "@/components/ability-tooltip";
import { getAbilityByInternalName } from "@/server/repositories/abilities";
import { getGameLocalization } from "@/server/services/game-localization";
import { displayName, relationLabel, textValues } from "@/presentation/dota";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{
    "internal-name": string;
  }>;
  searchParams: Promise<{
    lang?: string;
    release?: string | string[];
  }>;
};
export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = await getTranslations();
  const lang = await getRequestGameLocale();
  const selected = await resolvePageRelease(
    `/abilities/${(await params)["internal-name"]}`,
    await searchParams,
  );
  const detail = selected?.catalogId
    ? await getAbilityByInternalName(
        (await params)["internal-name"],
        lang,
        selected.catalogId,
      )
    : null;
  return {
    title: t("{value0} · 技能", {
      value0: displayName(
        detail?.localizations[0]?.display_name,
        t("技能详情"),
        detail ? textValues(detail.values, detail.ability, locale) : {},
        locale,
      ),
    }),
  };
}
export default async function AbilityDetailPage({
  params,
  searchParams,
}: Props) {
  const locale = await getRequestLocale();
  const t = await getTranslations();
  const internalName = (await params)["internal-name"];
  if (!/^[a-z0-9_]+$/u.test(internalName)) notFound();
  const lang = await getRequestGameLocale();
  const selected = await resolvePageRelease(
    `/abilities/${internalName}`,
    await searchParams,
  );
  if (selected && !selected.catalogId)
    return <MissingReleaseCoverage kind={t("技能")} />;
  const detail = await getAbilityByInternalName(
    internalName,
    lang,
    selected?.catalogId ?? undefined,
  );
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
        <Link href="/abilities">{t("← 全部技能")}</Link>
      </div>
      <SourceLanguageNotice
        partial
        sourceLocale={
          lang !== "en" &&
          (
            [
              "display_name",
              "description",
              "lore",
              "scepter_description",
              "shard_description",
            ] as const
          ).some((key) => !preferred?.[key] && english?.[key])
            ? "en"
            : undefined
        }
      />
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
          <h2 className="mb-2 text-sm font-medium text-[#d8c49a]">
            {t("所属英雄")}
          </h2>
          {owners.length ? (
            owners.map((owner) => (
              <Link
                className="mb-1 block p-2 text-sm hover:bg-white/5"
                key={owner.hero_id}
                href={`/heroes/${owner.slug}`}
              >
                <strong>
                  {displayName(
                    owner.hero_name,
                    t("英雄名称待补充"),
                    undefined,
                    locale,
                  )}
                </strong>
                <span className="mt-1 block text-xs text-[var(--text-muted)]">
                  {relationLabel(owner.relation_kind, locale)} →
                </span>
              </Link>
            ))
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              {t("此技能暂未关联可选英雄。")}
            </p>
          )}
          <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">
            {t(
              "技能数值以当前收录的游戏版本为准。天赋、命石和升级可能改变技能效果。",
            )}
          </p>
        </aside>
      </div>
      <OwnerAttributeList
        kind="ability"
        owner={internalName}
        dataset={detail.meta.datasetVersionId}
      />
    </main>
  );
}
