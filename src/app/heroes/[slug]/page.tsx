import { HeroSectionNav } from "@/components/hero-section-nav";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HeroCrest } from "@/components/hero-crest";
import { AbilityTooltip } from "@/components/ability-tooltip";
import { ShadowrazeCard } from "@/components/shadowraze-card";
import { AbilityIcon } from "@/components/ability-icon";
import { getHeroProfile } from "@/server/repositories/heroes";
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
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
};
export async function generateMetadata({
  params,
  searchParams,
}: Props): Promise<Metadata> {
  const detail = await getHeroProfile((await params).slug);
  const lang = (await searchParams).lang === "en" ? "en" : "zh-CN";
  return {
    title: `${displayName(detail?.localizations.find((l) => l.locale === lang)?.display_name, "英雄详情")} · 英雄`,
  };
}
export default async function HeroDetailPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const lang = (await searchParams).lang === "en" ? "en" : "zh-CN";
  const detail = await getHeroProfile(slug);
  if (!detail) notFound();
  const { hero, meta } = detail;
  const local =
    detail.localizations.find((l) => l.locale === lang) ??
    detail.localizations[0];
  const name = displayName(local?.display_name, "英雄名称待补充");
  const [spellbook, tokens] = await Promise.all([
    getHeroSpellbook(
      meta.datasetVersionId,
      hero.hero_id,
      lang,
      meta.sourceCommit,
    ),
    getGameLocalization(meta.datasetVersionId, meta.sourceCommit, lang),
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
      (a.relation_kind !== "declared_in_hero_file" || !a.is_hidden),
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
    rows: Array<[string, unknown, string?]>;
  }> = [
    {
      title: "攻击",
      rows: [
        [
          "基础攻击力",
          `${numbers(hero.base_attack_damage_min)} – ${numbers(hero.base_attack_damage_max)}`,
        ],
        ["基础攻击间隔", hero.attack_rate, "秒"],
        ["攻击前摇", hero.attack_animation_point, "秒"],
        ["攻击距离", hero.attack_range],
        ["基础攻击速度", hero.base_attack_speed],
        ["弹道速度", hero.projectile_speed],
      ],
    },
    {
      title: "防御与恢复",
      rows: [
        ["基础生命值", hero.base_health],
        ["基础生命恢复", hero.base_health_regen, "/ 秒"],
        ["基础魔法值", hero.base_mana],
        ["基础魔法恢复", hero.base_mana_regen, "/ 秒"],
        ["基础护甲", hero.base_armor],
        ["基础魔法抗性", hero.magic_resistance, "%"],
      ],
    },
    {
      title: "移动与视野",
      rows: [
        ["移动速度", hero.movement_speed],
        ["转身速率", hero.turn_rate],
        ["白天视野", hero.day_vision],
        ["夜间视野", hero.night_vision],
      ],
    },
  ];
  return (
    <main className="hero-detail mx-auto max-w-[var(--content-max)] px-4 py-3 sm:px-6">
      <div className="flex justify-between text-xs text-[var(--text-secondary)]">
        <Link href="/heroes">← 全部英雄</Link>
        <Link href={`/heroes/${slug}${lang === "en" ? "" : "?lang=en"}`}>
          {lang === "en" ? "简体中文" : "English"}
        </Link>
      </div>
      <header className="hero-stage mt-2">
        <HeroCrest
          name={name}
          attribute={String(hero.primary_attribute)}
          large
          src={`/valve-assets/hero/${hero.internal_name}?v=${encodeURIComponent(meta.assetDatasetVersionId)}`}
        />
        <div>
          <div className="hero-intro-heading">
            <h1 className="text-lg font-semibold leading-tight sm:text-xl">
              {name}
            </h1>
            <p className="text-[11px] text-[#cbb27c]">
              {labels[String(hero.primary_attribute)]} ·{" "}
              {labels[String(hero.attack_type)]}
            </p>
            <div className="attribute-stack">
              {[
                ["strength", "力量", "strength_gain"],
                ["agility", "敏捷", "agility_gain"],
                ["intelligence", "智力", "intelligence_gain"],
              ].map(([key, label, gain]) => (
                <div key={key} style={{ color: `var(--attribute-${key})` }}>
                  <span>{label}</span>
                  <strong>{numbers(hero[`base_${key}`])}</strong>
                  <small
                    title="每级成长"
                    aria-label={`每级成长 ${numbers(hero[gain])}`}
                  >
                    +{numbers(hero[gain])}
                  </small>
                </div>
              ))}
            </div>
          </div>
          <p className="game-description mt-1">{gameText(local?.hype)}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--text-secondary)]">
            <span>
              操作难度 {"◆".repeat(Number(hero.complexity))}
              {"◇".repeat(3 - Number(hero.complexity))}
            </span>
            {detail.roles.map((r) => (
              <span key={r.role}>
                {labels[r.role]} {"▰".repeat(r.role_level)}
              </span>
            ))}
          </div>
        </div>
      </header>
      <HeroSectionNav />
      <section id="abilities" className="mt-4">
        <h2 className="game-heading">英雄技能</h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {visibleSkills.map((a) => (
            <a
              href={`#skill-${a.internal_name}`}
              key={a.internal_name}
              aria-label={displayName(a.display_name)}
            >
              <AbilityIcon
                internalName={a.internal_name}
                name={displayName(a.display_name)}
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
                abilities={[shadowrazes[0]!, shadowrazes[1]!, shadowrazes[2]!]}
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
                tokens={tokens}
                assetVersion={meta.assetDatasetVersionId}
                lang={lang}
              />
            ),
          )}
        </div>
      </section>
      <div className="mt-5 grid items-start gap-4 lg:grid-cols-2">
        <section id="talents">
          <h2 className="game-heading">天赋树</h2>
          <div className="talent-tree">
            {[3, 2, 1, 0].map((tier) => (
              <div className="talent-tier" key={tier}>
                {[0, 1].map((side) => {
                  const talent = talents[tier * 2 + side];
                  return (
                    <div
                      key={side}
                      className={side === 0 ? "talent-left" : "talent-right"}
                    >
                      {talent ? (
                        <Link
                          href={`/abilities/${talent.internal_name}${lang === "en" ? "?lang=en" : ""}`}
                        >
                          {displayName(
                            talent.display_name,
                            "天赋说明待补充",
                            textValues(talent.values, talent),
                          )}
                        </Link>
                      ) : (
                        "天赋说明待补充"
                      )}
                    </div>
                  );
                })}
                <span className="talent-level">{10 + tier * 5}</span>
              </div>
            ))}
          </div>
        </section>
        <section id="facets">
          <h2 className="game-heading">命石</h2>
          <div className="space-y-2">
            {facets.map((facet, index) => {
              const prefix =
                `dota_tooltip_facet_${facet.facet_key}`.toLowerCase();
              return (
                <article key={facet.facet_key} className="facet-panel">
                  <h3 className="text-sm font-medium text-[#e2c184]">
                    {facet.deprecated && (
                      <span className="mr-2 text-xs text-[var(--text-muted)]">
                        历史命石 · 已移除
                      </span>
                    )}
                    ◈{" "}
                    {displayName(
                      tokens[prefix],
                      `命石 ${index + 1} · 名称待补充`,
                    )}
                  </h3>
                  <p className="game-description mt-2">
                    {gameText(tokens[`${prefix}_description`]) ||
                      "此命石的效果说明暂未提供。"}
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
                          {displayName(a.display_name)}：
                        </strong>
                        {gameText(
                          tokens[
                            `dota_tooltip_ability_${a.internal_name}_facet_${facet.facet_key}`.toLowerCase()
                          ],
                          textValues(a.values, a),
                        )}
                      </p>
                    ))}
                </article>
              );
            })}
            {!facets.length && (
              <p className="dota-panel text-sm text-[var(--text-muted)]">
                当前版本暂无命石说明。
              </p>
            )}
          </div>
        </section>
      </div>
      <section id="stats" className="mt-5">
        <h2 className="game-heading">英雄属性</h2>
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          基础数值尚未叠加力量、敏捷、智力带来的加成，也未计入天赋、命石与装备。
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          {groups.map((group) => (
            <section key={group.title} className="dota-panel">
              <h3 className="mb-2 text-sm font-medium text-[#d8c49a]">
                {group.title}
              </h3>
              <dl className="skill-values">
                {group.rows.map(([label, v, unit]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {typeof v === "string" && v.includes("–")
                        ? v
                        : numbers(v)}
                      {unit ? ` ${unit}` : ""}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </section>
      <section id="lore" className="mt-5">
        <h2 className="game-heading">英雄故事</h2>
        <p className="dota-panel game-description">
          {gameText(local?.lore) || "此英雄的背景故事暂未提供。"}
        </p>
      </section>
    </main>
  );
}
