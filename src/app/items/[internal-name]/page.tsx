import { OwnerAttributeList } from "@/components/owner-attribute-list";
import { SourceText } from "@/i18n/provider";
import { SourceLanguageNotice } from "@/i18n/provider";
import { getRequestGameLocale } from "@/i18n/server";
import { getTranslations } from "@/i18n/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "@/components/version-link";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import { ItemIcon } from "@/components/item-icon";
import { ItemSummary } from "@/components/item-summary";
import { getItemOverview } from "@/server/repositories/items";
import { resolvePageRelease } from "@/server/services/releases";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("物品详情") };
}
export const dynamic = "force-dynamic";
export default async function ItemPage({
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
  const [{ "internal-name": id }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const selected = await resolvePageRelease(`/items/${id}`, query);
  if (selected && !selected.catalogId)
    return <MissingReleaseCoverage kind={t("物品")} />;
  const { snapshot, imageVersion } = await getItemOverview(
    selected?.catalogId ?? undefined,
  );
  if (!snapshot)
    return (
      <MissingReleaseCoverage
        kind={t("物品")}
        reason={t(
          "该版本的物品资料尚未接入，请配置与收录版本匹配的游戏来源后重试。",
        )}
      />
    );
  const item = snapshot.items.find((value) => value.internalName === id);
  if (!item) notFound();
  const en = (await getRequestGameLocale()) === "en";
  const suffix = "";
  const itemLink = (key: string, index: number) => {
    // '*' is a source recipe marker; do not infer its engine semantics.
    const target = snapshot.items.find(
      (value) => value.internalName === key.replace(/\*+$/u, ""),
    );
    return target ? (
      <Link
        key={`${key}:${index}`}
        href={`/items/${target.internalName}${suffix}`}
        className="inline-flex items-center gap-2 bg-[#182127]/65 px-3 py-2 text-xs hover:text-[#c4a16a]"
      >
        <ItemIcon itemKey={target.internalName} version={imageVersion} />
        {en ? target.enName : target.zhName}
        {key.endsWith("*") ? t("（特殊合成条件）") : ""}
      </Link>
    ) : (
      <span
        key={`${key}:${index}`}
        className="text-xs text-[var(--text-muted)]"
      >
        {t("配方对象资料待补充")}
      </span>
    );
  };
  const recipes =
    item.category === "recipe"
      ? [item]
      : snapshot.items.filter((value) => value.result === id);
  const upgrades = snapshot.items.filter(
    (value) =>
      value.result &&
      value.requirements.some((group) =>
        group.some((key) => key.replace(/\*+$/u, "") === id),
      ),
  );
  return (
    <main className="mx-auto min-h-[70vh] max-w-[var(--content-max)] space-y-5 px-4 py-4 sm:px-6">
      <Link
        href={`/items${suffix}`}
        className="text-xs text-[var(--text-muted)]"
      >
        {t("← 物品图鉴")}
      </Link>
      <header className="flex items-center gap-4">
        <ItemIcon itemKey={item.internalName} version={imageVersion} large />
        <div>
          <h1 className="text-xl font-semibold">
            <SourceText sourceLocale={item.nameLocales?.[en ? "en" : "zh"]}>
              {en ? item.enName : item.zhName}
            </SourceText>
          </h1>
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            <SourceLanguageNotice
              sourceLocale={
                item.nameLocales?.[en ? "zh" : "en"] ?? (en ? "zh-CN" : "en")
              }
            />
            {" · "}
            <span
              lang={
                item.nameLocales?.[en ? "zh" : "en"] ?? (en ? "zh-CN" : "en")
              }
              data-source-text=""
            >
              {en ? item.zhName : item.enName}
            </span>
          </p>
        </div>
      </header>
      <section className="max-w-3xl bg-[#182127]/65 p-4">
        <h2 className="mb-4 text-sm font-semibold">{t("物品效果与属性")}</h2>
        <ItemSummary item={item} en={en} />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("合成配方")}</h2>
        {recipes.length ? (
          recipes.map((recipe) => (
            <div key={recipe.internalName} className="space-y-2">
              {recipe.internalName !== id && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)]">
                    {t("图纸")}
                  </span>
                  {itemLink(recipe.internalName, 0)}
                  <span className="text-xs text-[#c4a16a]">
                    {recipe.cost === null
                      ? t("价格未提供")
                      : t("{value0} 金币", {
                          value0: recipe.cost,
                        })}
                  </span>
                </div>
              )}
              {recipe.requirements.map((group, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)]">
                    {recipe.requirements.length > 1
                      ? t("方案 {value0}", {
                          value0: index + 1,
                        })
                      : t("所需组件")}
                  </span>
                  {group.map(itemLink)}
                </div>
              ))}
              {item.result && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)]">
                    {t("合成结果")}
                  </span>
                  {itemLink(item.result, 0)}
                </div>
              )}
            </div>
          ))
        ) : (
          <p className="text-xs text-[var(--text-muted)]">
            {t("此定义未配置合成配方。")}
          </p>
        )}
      </section>
      {upgrades.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">{t("可合成为")}</h2>
          <div className="flex flex-wrap gap-2">
            {[...new Set(upgrades.map((recipe) => recipe.result!))].map(
              itemLink,
            )}
          </div>
        </section>
      )}
      <p className="max-w-3xl text-[11px] leading-relaxed text-[var(--text-muted)]">
        {t(
          "展示收录版本的基础定义，也包含历史和活动内容；实际可用性、特殊合成条件与对局效果以游戏为准。",
        )}
      </p>
      <OwnerAttributeList
        kind="item"
        owner={id}
        dataset={selected?.catalogId ?? undefined}
      />
    </main>
  );
}
