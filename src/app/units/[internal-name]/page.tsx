import { OwnerAttributeList } from "@/components/owner-attribute-list";
import { unitVariant } from "@/presentation/map-labels";
import { SourceText } from "@/i18n/provider";
import { SourceLanguageNotice } from "@/i18n/provider";
import { getRequestLocale, getRequestGameLocale } from "@/i18n/server";
import { getTranslations } from "@/i18n/server";
import { resolvePageRelease } from "@/server/services/releases";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import { UnitPortrait } from "@/components/unit-portrait";
import { AbilityIcon } from "@/components/ability-icon";
import type { Metadata } from "next";
import Link from "@/components/version-link";
import { notFound } from "next/navigation";
import { UNIT_CATEGORIES } from "@/domain/units";
import { UnitStats } from "@/components/unit-stats";
import {
  getUnitOverview,
  getUnitAbilities,
  getUnitPortraits,
} from "@/server/repositories/units";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("单位详情") };
}
export const dynamic = "force-dynamic";
export default async function UnitPage({
  params,
  searchParams,
}: {
  params: Promise<{
    "internal-name": string;
  }>;
  searchParams: Promise<{
    lang?: string;
    release?: string | string[];
  }>;
}) {
  const t = await getTranslations();
  const locale = await getRequestLocale();
  const [{ "internal-name": id }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const selected = await resolvePageRelease(`/units/${id}`, query);
  if (selected && !selected.catalogId)
    return <MissingReleaseCoverage kind={t("单位")} />;
  const { meta, snapshot } = await getUnitOverview(
    selected?.catalogId ?? undefined,
  );
  if (!snapshot || !meta)
    return (
      <main className="mx-auto max-w-[var(--content-max)] px-4 py-12">
        <h1 className="text-xl">{t("单位资料暂不可用")}</h1>
        <Link href="/units" className="mt-4 block text-sm">
          {t("返回单位图鉴")}
        </Link>
      </main>
    );
  const unit = snapshot.units.find((value) => value.internalName === id);
  if (!unit) notFound();
  const portraits = await getUnitPortraits(meta.datasetVersionId);
  const en = (await getRequestGameLocale()) === "en";
  const abilities = await getUnitAbilities(meta, unit.abilities);
  return (
    <main className="mx-auto min-h-[70vh] max-w-[var(--content-max)] space-y-5 px-4 py-4 sm:px-6">
      <Link
        href={`/units${en ? "?lang=en" : ""}`}
        className="text-xs text-[var(--text-muted)]"
      >
        {t("← 单位图鉴")}
      </Link>
      <header className="flex items-center gap-3">
        <UnitPortrait
          unitKey={unit.internalName}
          name={en ? unit.enName : unit.zhName}
          portrait={portraits[unit.internalName]}
          large
        />
        <div>
          <h1 className="text-xl font-semibold">
            <SourceText sourceLocale={unit.nameLocales?.[en ? "en" : "zh"]}>
              {en ? unit.enName : unit.zhName}
            </SourceText>
          </h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            <SourceLanguageNotice
              sourceLocale={
                unit.nameLocales?.[en ? "zh" : "en"] ?? (en ? "zh-CN" : "en")
              }
            />
            {" · "}
            <span
              lang={
                unit.nameLocales?.[en ? "zh" : "en"] ?? (en ? "zh-CN" : "en")
              }
              data-source-text=""
            >
              {en ? unit.zhName : unit.enName}
            </span>
          </p>
          <p className="mt-2 text-xs text-[#c4a16a]">
            {[
              t(UNIT_CATEGORIES[unit.category]),
              t(unit.team),
              t(unit.attack),
              unitVariant(unit.variant, locale),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>
      <section className="bg-[#182127]/65 p-4">
        <h2 className="mb-4 text-sm font-semibold">{t("基础属性")}</h2>
        <UnitStats unit={unit} />
        <p className="mt-4 text-[11px] leading-relaxed text-[var(--text-muted)]">
          {t(
            "数值来自收录版本的单位基础定义，包含公共默认值；对局时间、难度、召唤技能等级与其他效果可能改变实际属性。未解析的值标为待确认。",
          )}
        </p>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("单位技能")}</h2>
        {abilities.length ? (
          <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6">
            {abilities.map((ability, index) => (
              <li
                key={`${ability.internalName}:${index}`}
                className="bg-[#182127]/65 p-3 text-xs"
              >
                {ability.available && (ability.zhName || ability.enName) ? (
                  <Link
                    href={`/abilities/${ability.internalName}${en ? "?lang=en" : ""}`}
                    className="flex items-center gap-2 hover:text-[#c4a16a]"
                  >
                    <AbilityIcon
                      internalName={ability.internalName}
                      name={ability.zhName || ability.enName || t("技能")}
                      assetVersion={meta.assetDatasetVersionId}
                      compact
                    />
                    {(en ? ability.enName : ability.zhName) ||
                      ability.zhName ||
                      ability.enName}
                  </Link>
                ) : (
                  <span className="text-[var(--text-muted)]">
                    {t("技能资料待补充")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            {t("此定义没有配置可展示的技能。")}
          </p>
        )}
      </section>
      <OwnerAttributeList
        kind="unit"
        owner={id}
        dataset={meta.datasetVersionId}
      />
    </main>
  );
}
