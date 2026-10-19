import { HeroRankValue } from "@/components/hero-stat-rankings";
import {
  HeroReferenceProvider,
  HeroReferenceText,
} from "@/components/hero-reference-text";
import { HeroStatRelation } from "@/components/hero-stats-relations";
import { Fragment } from "react";
import { getHeroInventoryCatalog } from "@/server/services/hero-inventory";
import { adaptHeroTalents } from "@/presentation/hero-talents";
import { HERO_STATS_FIELDS } from "@/presentation/hero-stats";
import { OwnerAttributeList } from "@/components/owner-attribute-list";
import { AttributeLink } from "@/components/attribute-link";
import { SourceLanguageNotice } from "@/i18n/provider";
import { getRequestGameLocale } from "@/i18n/server";
import { getTranslations } from "@/i18n/server";
import { Message } from "@/i18n/provider";
import { getRequestLocale } from "@/i18n/server";
import { resolvePageRelease } from "@/server/services/releases";
import { MissingReleaseCoverage } from "@/components/release-navigation";
import { HeroBuildProvider } from "@/components/hero-build-provider";
import { HeroOverview } from "@/components/hero-overview";
import { PageInfoTooltip } from "@/components/ui/page-info-tooltip";
import { HeroSectionNav } from "@/components/hero-section-nav";
import type { Metadata } from "next";
import Link from "@/components/version-link";
import { notFound } from "next/navigation";
import { HeroCrest } from "@/components/hero-crest";
import { AbilityTooltip } from "@/components/ability-tooltip";
import { ShadowrazeCard } from "@/components/shadowraze-card";
import { AbilityIcon } from "@/components/ability-icon";
import {
  getHeroProfile,
  getHeroRankingRows,
} from "@/server/repositories/heroes";
import { getHeroSpellbook } from "@/server/repositories/abilities";
import { getGameLocalization } from "@/server/services/game-localization";
import {
  displayName,
  gameText,
  labels,
  numbers,
  textValues,
} from "@/presentation/dota";
export const dynamic = "force-dynamic";
type Props = {
  params: Promise<{
    slug: string;
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
  const query = await searchParams;
  const selected = await resolvePageRelease(
    `/heroes/${(await params).slug}`,
    query,
  );
  const detail = selected?.catalogId
    ? await getHeroProfile((await params).slug, selected.catalogId)
    : null;
  const lang = await getRequestGameLocale();
  return {
    title: t("{value0} · 英雄", {
      value0: displayName(
        detail?.localizations.find((l) => l.locale === lang)?.display_name,
        t("英雄详情"),
        undefined,
        locale,
      ),
    }),
  };
}
export default async function HeroDetailPage({ params, searchParams }: Props) {
  const locale = await getRequestLocale();
  const t = await getTranslations();
  const { slug } = await params;
  const lang = await getRequestGameLocale();
  const selected = await resolvePageRelease(
    `/heroes/${slug}`,
    await searchParams,
  );
  if (selected && !selected.catalogId)
    return <MissingReleaseCoverage kind={t("英雄")} />;
  const detail = await getHeroProfile(slug, selected?.catalogId ?? undefined);
  if (!detail) notFound();
  const { hero, meta } = detail;
  const local =
    detail.localizations.find((l) => l.locale === lang) ??
    detail.localizations[0];
  const name = displayName(
    local?.display_name,
    t("英雄名称待补充"),
    undefined,
    locale,
  );
  const [spellbook, tokens, inventory, rankingHeroes] = await Promise.all([
    getHeroSpellbook(
      meta.datasetVersionId,
      hero.hero_id,
      lang,
      meta.sourceCommit,
    ),
    getGameLocalization(meta.datasetVersionId, meta.sourceCommit, lang),
    getHeroInventoryCatalog(
      meta.datasetVersionId,
      String(hero.primary_attribute),
    ),
    getHeroRankingRows(meta.datasetVersionId, lang),
  ]);
  const unique = [
    ...new Map(
      spellbook
        .filter((a) => a.relation_kind !== "talent")
        .map((a) => [a.internal_name, a]),
    ).values(),
  ];
  const skills = unique.filter(
    (a) =>
      a.internal_name !== "generic_hidden" &&
      (a.relation_kind !== "declared_in_hero_file" ||
        !a.is_hidden ||
        a.is_granted_by_scepter ||
        a.is_granted_by_shard),
  );
  const shadowrazes = [1, 2, 3].map((range) =>
    skills.find(
      (ability) => ability.internal_name === `nevermore_shadowraze${range}`,
    ),
  );
  const combinedShadowrazes =
    slug === "nevermore" && shadowrazes.every(Boolean);
  const visibleSkills = combinedShadowrazes
    ? skills.filter(
        (ability) =>
          !["nevermore_shadowraze2", "nevermore_shadowraze3"].includes(
            ability.internal_name,
          ),
      )
    : skills;
  const talents = [
    ...new Map(
      spellbook
        .filter((a) => a.relation_kind === "talent")
        .map((a) => [a.source_slot, a]),
    ).values(),
  ].sort((a, b) => a.ordinal - b.ordinal);
  const facets = detail.facets;
  const groups: Array<{
    title: string;
    rows: Array<[string, unknown, string?, string?]>;
  }> = [
    {
      title: t("攻击"),
      rows: [
        [
          t("基础攻击力"),
          `${numbers(hero.base_attack_damage_min, locale)} – ${numbers(hero.base_attack_damage_max, locale)}`,
          undefined,
          "base_attack_damage_min",
        ],
        [t("基础攻击间隔"), hero.attack_rate, t("秒"), "attack_rate"],
        [
          t("攻击前摇"),
          hero.attack_animation_point,
          t("秒"),
          "attack_animation_point",
        ],
        [t("攻击距离"), hero.attack_range, undefined, "attack_range"],
        [
          t("基础攻击速度"),
          hero.base_attack_speed,
          undefined,
          "base_attack_speed",
        ],
        [t("弹道速度"), hero.projectile_speed, undefined, "projectile_speed"],
      ],
    },
    {
      title: t("防御与恢复"),
      rows: [
        [t("基础生命值"), hero.base_health, undefined, "base_health"],
        [
          t("基础生命恢复"),
          hero.base_health_regen,
          t("/ 秒"),
          "base_health_regen",
        ],
        [t("基础魔法值"), hero.base_mana, undefined, "base_mana"],
        [t("基础魔法恢复"), hero.base_mana_regen, t("/ 秒"), "base_mana_regen"],
        [t("基础护甲"), hero.base_armor, undefined, "base_armor"],
        [t("基础魔法抗性"), hero.magic_resistance, "%", "magic_resistance"],
      ],
    },
    {
      title: t("移动与视野"),
      rows: [
        [t("移动速度"), hero.movement_speed, undefined, "movement_speed"],
        [t("转身速率"), hero.turn_rate, undefined, "turn_rate"],
        [t("白天视野"), hero.day_vision, undefined, "day_vision"],
        [t("夜间视野"), hero.night_vision, undefined, "night_vision"],
      ],
    },
  ];
  return (
    <main className="hero-detail mx-auto max-w-[var(--content-max)] px-4 py-3 sm:px-6">
      <div className="flex justify-between text-xs text-[var(--text-secondary)]">
        <Link href="/heroes">{t("← 全部英雄")}</Link>
      </div>
      <HeroReferenceProvider
        abilities={skills}
        tokens={tokens}
        assetVersion={meta.assetDatasetVersionId}
      >
        <HeroBuildProvider
          key={`${meta.datasetVersionId}:${slug}`}
          abilities={skills}
          sourceCommit={meta.sourceCommit}
          catalogVersion={meta.datasetVersionId}
          abilityImageVersion={meta.assetDatasetVersionId}
          inventoryCatalog={inventory.catalog}
          itemImageVersion={inventory.imageVersion}
          attackType={String(hero.attack_type)}
          talents={adaptHeroTalents(
            talents,
            spellbook,
            meta.sourceCommit,
            locale,
          )}
        >
          <HeroOverview
            rankingHeroes={rankingHeroes}
            heroName={name}
            sourceCommit={meta.sourceCommit}
            hero={Object.fromEntries(
              HERO_STATS_FIELDS.map((key) => [key, hero[key]]),
            )}
            intro={
              <Fragment key="intro">
                <HeroCrest
                  key="portrait"
                  name={name}
                  attribute={String(hero.primary_attribute)}
                  large
                  src={`/valve-assets/hero/${hero.internal_name}?v=${encodeURIComponent(meta.assetDatasetVersionId)}`}
                />
                <div key="identity">
                  <div className="hero-intro-heading">
                    <h1 className="text-lg font-semibold leading-tight sm:text-xl">
                      {name}
                    </h1>
                    <SourceLanguageNotice sourceLocale={local?.locale} />
                    <p className="text-[11px] text-[#cbb27c]">
                      {t(labels[String(hero.primary_attribute)])} ·{" "}
                      {t(labels[String(hero.attack_type)])}
                    </p>
                    {local?.hype && (
                      <PageInfoTooltip label={t("英雄介绍")}>
                        {gameText(local.hype, undefined, locale)}
                      </PageInfoTooltip>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                    <span>
                      <Message
                        id="操作难度 {value0}{value1}"
                        values={{
                          value0: "◆".repeat(Number(hero.complexity)),
                          value1: "◇".repeat(3 - Number(hero.complexity)),
                        }}
                      />
                    </span>
                    {detail.roles.map((r) => (
                      <span key={r.role}>
                        {t(labels[r.role])} {"▰".repeat(r.role_level)}
                      </span>
                    ))}
                  </div>
                </div>
              </Fragment>
            }
            stats={
              <div key="stats" className="grid gap-4 sm:grid-cols-3">
                {groups.map((group) => (
                  <section key={group.title} className="min-w-0">
                    <h3 className="mb-2 text-sm font-medium text-[#d8c49a]">
                      {group.title}
                    </h3>
                    <dl className="skill-values">
                      {group.rows.map(([label, v, unit, field]) => (
                        <HeroStatRelation key={label} field={field!}>
                          <dt>
                            <AttributeLink
                              kind="hero"
                              owner={String(hero.internal_name)}
                              field={field!}
                            >
                              {label}
                            </AttributeLink>
                          </dt>
                          <dd>
                            <HeroRankValue
                              stat={`raw:${field}`}
                              label={label}
                              endStat={
                                field === "base_attack_damage_min"
                                  ? "raw:base_attack_damage_max"
                                  : undefined
                              }
                            >
                              {typeof v === "string" && v.includes("–")
                                ? v
                                : numbers(v, locale)}
                              {unit ? ` ${unit}` : ""}
                            </HeroRankValue>
                          </dd>
                        </HeroStatRelation>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            }
          />
          <HeroSectionNav />
          <section id="abilities" className="mt-4">
            <h2 className="game-heading">{t("英雄技能")}</h2>
            <div className="mb-3 flex flex-wrap gap-2">
              {visibleSkills.map((a) => (
                <a
                  href={`#skill-${a.internal_name}`}
                  key={a.internal_name}
                  aria-label={displayName(
                    a.display_name,
                    undefined,
                    undefined,
                    locale,
                  )}
                >
                  <AbilityIcon
                    internalName={a.internal_name}
                    name={displayName(
                      a.display_name,
                      undefined,
                      undefined,
                      locale,
                    )}
                    assetVersion={meta.assetDatasetVersionId}
                  />
                </a>
              ))}
            </div>
            <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleSkills.map((a) =>
                combinedShadowrazes &&
                a.internal_name === "nevermore_shadowraze1" ? (
                  <ShadowrazeCard
                    key={a.internal_name}
                    abilities={[
                      shadowrazes[0]!,
                      shadowrazes[1]!,
                      shadowrazes[2]!,
                    ]}
                    tokens={Object.fromEntries(
                      Object.entries(tokens).filter(([key]) =>
                        /^dota_tooltip_ability_nevermore_shadowraze[123](?:_|$)/u.test(
                          key,
                        ),
                      ),
                    )}
                    assetVersion={meta.assetDatasetVersionId}
                    lang={lang}
                  />
                ) : (
                  <AbilityTooltip
                    key={a.internal_name}
                    ability={a}
                    adjustableLevel
                    tokens={tokens}
                    assetVersion={meta.assetDatasetVersionId}
                    lang={lang}
                  />
                ),
              )}
            </div>
          </section>
          <section id="facets" className="mt-5">
            <h2 className="game-heading">{t("命石")}</h2>
            <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
              {facets.map((facet, index) => {
                const prefix =
                  `dota_tooltip_facet_${facet.facet_key}`.toLowerCase();
                return (
                  <article key={facet.facet_key} className="facet-panel">
                    <h3 className="text-sm font-medium text-[#e2c184]">
                      {facet.deprecated && (
                        <span className="mr-2 text-xs text-[var(--text-muted)]">
                          {t("历史命石 · 已移除")}
                        </span>
                      )}
                      ◈{" "}
                      {displayName(
                        tokens[prefix],
                        t("命石 {value0} · 名称待补充", {
                          value0: index + 1,
                        }),
                        undefined,
                        locale,
                      )}
                    </h3>
                    <p className="game-description mt-2">
                      <HeroReferenceText
                        text={
                          gameText(
                            tokens[`${prefix}_description`],
                            undefined,
                            locale,
                          ) || t("此命石的效果说明暂未提供。")
                        }
                      />
                    </p>
                    {skills
                      .filter(
                        (a) =>
                          tokens[
                            `dota_tooltip_ability_${a.internal_name}_facet_${facet.facet_key}`.toLowerCase()
                          ],
                      )
                      .map((a) => (
                        <p
                          key={a.internal_name}
                          className="game-description mt-2"
                        >
                          <strong className="text-[#cbb27c]">
                            <HeroReferenceText
                              text={displayName(
                                a.display_name,
                                undefined,
                                undefined,
                                locale,
                              )}
                            />
                            ：
                          </strong>
                          <HeroReferenceText
                            text={gameText(
                              tokens[
                                `dota_tooltip_ability_${a.internal_name}_facet_${facet.facet_key}`.toLowerCase()
                              ],
                              textValues(a.values, a, locale),
                              locale,
                            )}
                          />
                        </p>
                      ))}
                  </article>
                );
              })}
              {!facets.length && (
                <p className="dota-panel text-sm text-[var(--text-muted)]">
                  {t("当前版本暂无命石说明。")}
                </p>
              )}
            </div>
          </section>
        </HeroBuildProvider>
      </HeroReferenceProvider>
      <section id="lore" className="mt-5">
        <h2 className="game-heading">{t("英雄故事")}</h2>
        <p className="dota-panel game-description">
          {gameText(local?.lore, undefined, locale) ||
            t("此英雄的背景故事暂未提供。")}
        </p>
      </section>
      <OwnerAttributeList
        kind="hero"
        owner={String(hero.internal_name)}
        dataset={meta.datasetVersionId}
      />
    </main>
  );
}
