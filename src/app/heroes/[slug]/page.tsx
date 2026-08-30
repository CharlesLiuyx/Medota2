import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  CircleSlash2,
  Database,
  GitCommitHorizontal,
  ScrollText,
  Shield,
  Sparkles,
  Swords,
  TriangleAlert,
} from "lucide-react";
import { AbilityIcon } from "@/components/ability-icon";
import { HeroCrest } from "@/components/hero-crest";
import { getHeroBySlug } from "@/server/repositories/heroes";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  return { title: `${(await params).slug} · 英雄详情` };
}

const labels: Record<string, string> = {
  strength: "力量",
  agility: "敏捷",
  intelligence: "智力",
  universal: "全才",
  melee: "近战",
  ranged: "远程",
  radiant: "天辉",
  dire: "夜魇",
  carry: "核心",
  support: "辅助",
  nuker: "爆发",
  disabler: "控制",
  durable: "耐久",
  escape: "逃生",
  pusher: "推进",
  initiator: "先手",
};

export default async function HeroDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { slug } = await params;
  const lang = (await searchParams).lang === "en" ? "en" : "zh-CN";
  let detail: Awaited<ReturnType<typeof getHeroBySlug>>;
  try {
    detail = await getHeroBySlug(slug);
  } catch (error) {
    return (
      <main className="mx-auto min-h-[70vh] max-w-3xl px-5 py-20 text-center">
        <TriangleAlert className="mx-auto size-9 text-[#d85a3a]" />
        <h1 className="mt-5 text-2xl font-semibold">无法读取英雄数据</h1>
        <p className="mt-3 break-words text-sm text-zinc-500">
          {error instanceof Error ? error.message : String(error)}
        </p>
        <Link
          href="/heroes"
          className="mt-7 inline-flex items-center gap-2 text-sm text-[#df6a4d] hover:text-[#f18a70]"
        >
          <ArrowLeft className="size-4" /> 返回英雄总览
        </Link>
      </main>
    );
  }
  if (!detail) notFound();

  const hero = detail.hero;
  const zh = detail.localizations.find((item) => item.locale === "zh-CN")!;
  const en = detail.localizations.find((item) => item.locale === "en")!;
  return (
    <main className="mx-auto max-w-[1320px] px-5 py-8 sm:px-8 lg:px-10 lg:py-12">
      <Link
        href="/heroes"
        className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-white"
      >
        <ArrowLeft className="size-3.5" /> 返回全部英雄
      </Link>

      <section className="mt-7 grid gap-8 border-b border-white/9 pb-10 lg:grid-cols-[auto_1fr_auto] lg:items-end">
        <HeroCrest
          name={en.display_name}
          attribute={String(hero.primary_attribute)}
          large
          src={`/valve-assets/hero/${String(hero.internal_name)}?v=${encodeURIComponent(detail.meta.assetDatasetVersionId)}`}
        />
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            <span>Hero #{hero.hero_id}</span>
            <span>·</span>
            <span>{hero.internal_name}</span>
          </div>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-white sm:text-6xl">
            {lang === "en" ? en.display_name : zh.display_name}
          </h1>
          <p className="mt-2 text-lg text-zinc-500">
            {lang === "en" ? zh.display_name : en.display_name}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Badge>{labels[String(hero.primary_attribute)]}</Badge>
            <Badge>
              <Swords className="size-3" /> {labels[String(hero.attack_type)]}
            </Badge>
            <Badge>
              <Shield className="size-3" /> {labels[String(hero.faction)]}
            </Badge>
            <Badge>复杂度 {String(hero.complexity)}</Badge>
            <Badge muted={!hero.cm_enabled}>
              {hero.cm_enabled ? (
                <CheckCircle2 className="size-3" />
              ) : (
                <CircleSlash2 className="size-3" />
              )}{" "}
              CM
            </Badge>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-px border border-white/9 bg-white/9 text-right lg:w-72">
          <SmallMeta label="ClientVersion" value={detail.meta.clientVersion} />
          <SmallMeta
            label="SourceRevision"
            value={detail.meta.sourceRevision}
          />
          <SmallMeta
            label="Commit"
            value={detail.meta.sourceCommit.slice(0, 8)}
          />
          <SmallMeta
            label="Dataset"
            value={detail.meta.datasetVersionId.slice(0, 8)}
          />
          <Link
            href={`/heroes/${slug}`}
            aria-current={lang === "zh-CN" ? "page" : undefined}
            className="bg-[#111317] p-3 text-center text-xs hover:bg-[var(--surface-hover)]"
          >
            简中
          </Link>
          <Link
            href={`/heroes/${slug}?lang=en`}
            aria-current={lang === "en" ? "page" : undefined}
            className="bg-[#111317] p-3 text-center text-xs hover:bg-[var(--surface-hover)]"
          >
            EN
          </Link>
        </div>
      </section>

      <nav
        aria-label="Hero sections"
        className="sticky top-16 z-20 flex overflow-x-auto border-b border-[var(--border-default)] bg-[var(--surface-overlay)] text-xs backdrop-blur"
      >
        {[
          ["overview", "Overview"],
          ["abilities", "Abilities"],
          ["talents", "Talents & Upgrades"],
          ["raw", "Raw"],
          ["provenance", "Provenance"],
        ].map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="shrink-0 px-4 py-3 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {label}
          </a>
        ))}
      </nav>

      <div className="mt-10 grid gap-10 xl:grid-cols-[minmax(0,1fr)_350px]">
        <div className="space-y-10">
          <section id="overview">
            <SectionTitle
              icon={<ScrollText />}
              eyebrow="Overview"
              title="英雄简介"
            />
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <LocalizedText label="简体中文" value={zh.hype} />
              <LocalizedText label="English" value={en.hype} />
            </div>
          </section>

          <section id="abilities">
            <SectionTitle
              icon={<Swords />}
              eyebrow="Ability graph"
              title="Abilities"
            />
            <HeroAbilityList
              abilities={detail.abilities.filter(
                (ability) =>
                  ability.relation_kind !== "talent" &&
                  ability.relation_kind !== "declared_in_hero_file",
              )}
              assetVersion={detail.meta.assetDatasetVersionId}
              lang={lang}
            />
          </section>

          <section id="talents">
            <SectionTitle
              icon={<Sparkles />}
              eyebrow="Talents · Facets · Aghanim"
              title="Talents & Upgrades"
            />
            <HeroAbilityList
              abilities={detail.abilities.filter(
                (ability) =>
                  ability.relation_kind === "talent" ||
                  ability.relation_kind === "upgrade_granted" ||
                  ability.has_scepter_upgrade ||
                  ability.has_shard_upgrade,
              )}
              assetVersion={detail.meta.assetDatasetVersionId}
              lang={lang}
            />
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {detail.facets.map((facet) => (
                <div
                  key={facet.facet_key}
                  className="border border-[var(--border-default)] bg-[var(--surface-panel)] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <code className="text-xs text-[var(--text-primary)]">
                      {facet.facet_key}
                    </code>
                    <Badge muted={facet.deprecated}>
                      {facet.deprecated ? "Deprecated" : "Current"}
                    </Badge>
                  </div>
                  <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                    {facet.icon ?? "no icon"} · {facet.color ?? "no color"} ·
                    gradient {facet.gradient_id ?? "—"}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section id="raw">
            <SectionTitle
              icon={<Database />}
              eyebrow="Raw components"
              title="基础 / 原始定义"
            />
            <p className="mt-2 text-xs text-zinc-600">
              以下数值不叠加主属性、敏捷护甲等一级英雄面板计算。
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <StatGroup
                title="属性"
                rows={[
                  [
                    "基础力量",
                    hero.base_strength,
                    `+${formatValue(hero.strength_gain)}`,
                  ],
                  [
                    "基础敏捷",
                    hero.base_agility,
                    `+${formatValue(hero.agility_gain)}`,
                  ],
                  [
                    "基础智力",
                    hero.base_intelligence,
                    `+${formatValue(hero.intelligence_gain)}`,
                  ],
                ]}
              />
              <StatGroup
                title="生存"
                rows={[
                  ["基础生命", hero.base_health],
                  ["生命恢复", hero.base_health_regen],
                  ["基础魔法", hero.base_mana],
                  ["魔法恢复", hero.base_mana_regen],
                  ["基础护甲", hero.base_armor],
                  ["魔法抗性", hero.magic_resistance, "%"],
                ]}
              />
              <StatGroup
                title="攻击"
                rows={[
                  [
                    "基础伤害",
                    `${formatValue(hero.base_attack_damage_min)} – ${formatValue(hero.base_attack_damage_max)}`,
                  ],
                  ["基础攻击速度", hero.base_attack_speed],
                  ["攻击间隔定义", hero.attack_rate],
                  ["攻击前摇", hero.attack_animation_point],
                  ["攻击距离", hero.attack_range],
                  ["弹道速度", hero.projectile_speed],
                ]}
              />
              <StatGroup
                title="移动与视野"
                rows={[
                  ["移动速度", hero.movement_speed],
                  ["转身速率", hero.turn_rate],
                  ["白天视野", hero.day_vision],
                  ["夜间视野", hero.night_vision],
                ]}
              />
            </div>
          </section>

          <section>
            <SectionTitle
              icon={<BookOpen />}
              eyebrow="Biography"
              title="英雄背景"
            />
            <div className="mt-5 space-y-4">
              <LocalizedText label="简体中文" value={zh.lore} spacious />
              <LocalizedText label="English" value={en.lore} spacious />
            </div>
          </section>

          <ReferenceComparison comparison={detail.comparison} />
        </div>

        <aside id="provenance" className="space-y-5">
          <section className="border border-white/9 bg-[#121418] p-5">
            <p className="text-[10px] uppercase tracking-[0.22em] text-zinc-600">
              角色强度
            </p>
            <div className="mt-4 space-y-3">
              {detail.roles.map((role) => (
                <div
                  key={role.role}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 text-xs"
                >
                  <span className="text-zinc-300">
                    {labels[role.role] ?? role.role}
                  </span>
                  <span className="flex gap-1">
                    {[1, 2, 3].map((level) => (
                      <span
                        key={level}
                        className={`h-1.5 w-7 ${level <= role.role_level ? "bg-[#d86144]" : "bg-white/8"}`}
                      />
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </section>
          <Provenance detail={detail} />
        </aside>
      </div>
    </main>
  );
}

function Badge({
  children,
  muted = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[10px] uppercase tracking-wider ${muted ? "border-zinc-700 text-zinc-500" : "border-white/12 text-zinc-300"}`}
    >
      {children}
    </span>
  );
}

function SmallMeta({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#111317] p-3">
      <p className="text-[9px] uppercase tracking-wider text-zinc-600">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-xs text-zinc-300">{value}</p>
    </div>
  );
}

function SectionTitle({
  icon,
  eyebrow,
  title,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="flex items-end justify-between border-b border-white/9 pb-3">
      <div>
        <p className="text-[9px] uppercase tracking-[0.24em] text-[#cb5b40]">
          {eyebrow}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-white">{title}</h2>
      </div>
      <span className="text-zinc-700 [&>svg]:size-5">{icon}</span>
    </div>
  );
}

function LocalizedText({
  label,
  value,
  spacious = false,
}: {
  label: string;
  value: string | null;
  spacious?: boolean;
}) {
  return (
    <div
      className={`border border-white/8 bg-white/[0.018] p-5 ${spacious ? "sm:p-7" : ""}`}
    >
      <p className="text-[9px] uppercase tracking-[0.22em] text-zinc-600">
        {label}
      </p>
      <p
        className={`mt-3 whitespace-pre-wrap text-sm leading-7 ${value ? "text-zinc-300" : "italic text-zinc-600"}`}
      >
        {value ? cleanUpstreamText(value) : "当前 VPK 快照未提供"}
      </p>
    </div>
  );
}

function StatGroup({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, unknown, string?]>;
}) {
  return (
    <div className="border border-white/8 bg-[#121418] p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-x-5">
        {rows.map(([label, value, suffix]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-2 border-b border-white/6 py-2.5"
          >
            <dt className="text-[11px] text-zinc-600">{label}</dt>
            <dd className="font-mono text-xs tabular-nums text-zinc-200">
              {formatValue(value)}
              {suffix && !suffix.startsWith("+") ? (
                suffix
              ) : (
                <span className="ml-1 text-[9px] text-zinc-600">{suffix}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function HeroAbilityList({
  abilities,
  assetVersion,
  lang,
}: {
  abilities: NonNullable<
    Awaited<ReturnType<typeof getHeroBySlug>>
  >["abilities"];
  assetVersion: string;
  lang: "en" | "zh-CN";
}) {
  if (!abilities.length) {
    return (
      <div className="mt-5 border border-dashed border-[var(--border-default)] p-6 text-sm text-[var(--text-muted)]">
        当前关系图没有此类 Ability。
      </div>
    );
  }
  return (
    <div className="mt-5 grid gap-2 md:grid-cols-2">
      {abilities.map((ability) => (
        <Link
          key={`${ability.internal_name}-${ability.relation_kind}-${ability.source_slot}`}
          href={`/abilities/${ability.internal_name}${lang === "en" ? "?lang=en" : ""}`}
          className="flex gap-3 border border-[var(--border-default)] bg-[var(--surface-panel)] p-3 hover:bg-[var(--surface-hover)]"
        >
          <AbilityIcon
            internalName={ability.internal_name}
            assetVersion={assetVersion}
            name={
              (lang === "en" ? ability.en_name : ability.zh_name) ??
              ability.en_name ??
              ability.internal_name
            }
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
              {(lang === "en" ? ability.en_name : ability.zh_name) ??
                ability.en_name ??
                ability.internal_name}
            </span>
            <code className="mt-1 block truncate text-[9px] text-[var(--text-muted)]">
              {ability.internal_name}
            </code>
            <span className="mt-2 flex flex-wrap gap-1">
              <Badge>{ability.relation_kind}</Badge>
              <Badge muted={!ability.is_current}>
                {ability.is_current ? "current" : ability.catalog_status}
              </Badge>
              {ability.is_innate && <Badge>innate</Badge>}
              {ability.is_ultimate && <Badge>ultimate</Badge>}
              {ability.has_scepter_upgrade && <Badge>scepter</Badge>}
              {ability.has_shard_upgrade && <Badge>shard</Badge>}
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function Provenance({
  detail,
}: {
  detail: NonNullable<Awaited<ReturnType<typeof getHeroBySlug>>>;
}) {
  const hero = detail.hero;
  return (
    <section className="border border-white/9 bg-[#121418] p-5">
      <div className="flex items-center gap-2">
        <GitCommitHorizontal className="size-4 text-[#d86144]" />
        <h2 className="text-sm font-semibold text-white">Catalog Provenance</h2>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-zinc-600">
        共享 Catalog 快照 + 记录级溯源；Ability 可继续下钻到 ordered source。
      </p>
      <dl className="mt-5 space-y-3 text-[11px]">
        <Trace label="Repository" value={detail.meta.sourceRepository} />
        <Trace label="Commit" value={detail.meta.sourceCommit} mono />
        <Trace label="VDF key" value={hero.source_key} mono />
        <Trace label="DTO SHA-256" value={hero.source_dto_sha256} mono />
        <Trace label="Importer" value={detail.meta.importerVersion} mono />
        <Trace label="Schema" value={detail.meta.schemaVersion} mono />
        <Trace
          label="Imported"
          value={new Intl.DateTimeFormat("zh-CN", {
            dateStyle: "medium",
            timeStyle: "medium",
          }).format(detail.meta.importedAt)}
        />
      </dl>
      <details className="mt-5 border-t border-white/8 pt-4">
        <summary className="cursor-pointer list-none text-[11px] text-zinc-400 hover:text-white">
          查看 {detail.sourceFiles.length} 个输入文件 checksum
        </summary>
        <div className="mt-4 space-y-4">
          {detail.sourceFiles.map((file) => (
            <div key={file.source_path}>
              <p className="break-all text-[10px] text-zinc-400">
                {file.source_path}
              </p>
              <code className="mt-1 block break-all text-[9px] text-zinc-700">
                {file.raw_sha256} · {file.encoding} · {file.size_bytes} B
              </code>
            </div>
          ))}
        </div>
      </details>
      <details className="mt-3 border-t border-white/8 pt-4">
        <summary className="cursor-pointer list-none text-[11px] text-zinc-400 hover:text-white">
          查看本地化 token 与继承字段
        </summary>
        <div className="mt-4 space-y-4 text-[9px] text-zinc-600">
          {detail.localizations.map((locale) => (
            <div key={locale.locale}>
              <p className="font-semibold text-zinc-500">{locale.locale}</p>
              <code className="mt-1 block break-all">
                {locale.name_source_path} · {locale.name_token}
              </code>
              <code className="mt-1 block break-all">
                {locale.hype_token ?? "hype: NULL"}
              </code>
              <code className="mt-1 block break-all">
                {locale.lore_token ?? "lore: NULL"}
              </code>
            </div>
          ))}
          <div>
            <p className="font-semibold text-zinc-500">Inherited</p>
            <code className="mt-1 block break-all">
              {hero.inherited_fields.join(", ") || "none"}
            </code>
          </div>
        </div>
      </details>
    </section>
  );
}

function Trace({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: unknown;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-zinc-600">{label}</dt>
      <dd
        className={`mt-0.5 break-all text-zinc-300 ${mono ? "font-mono text-[9px]" : ""}`}
      >
        {String(value)}
      </dd>
    </div>
  );
}

function ReferenceComparison({
  comparison,
}: {
  comparison: NonNullable<
    Awaited<ReturnType<typeof getHeroBySlug>>
  >["comparison"];
}) {
  return (
    <section>
      <SectionTitle
        icon={<CircleSlash2 />}
        eyebrow="Non-canonical reference"
        title="参考数据差异"
      />
      {!comparison ? (
        <p className="mt-5 border border-dashed border-white/10 p-6 text-sm text-zinc-600">
          尚未为当前 dataset version 生成 dotaconstants
          比较。它是可选步骤，不影响规范页面。
        </p>
      ) : (
        <div className="mt-5 border border-white/8 bg-[#121418]">
          <div className="flex flex-col gap-2 border-b border-white/8 p-4 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
            <p>
              <span className="text-amber-300">
                dotaconstants 参考，不参与规范值
              </span>
            </p>
            <code className="text-[9px]">
              {comparison.packageVersion} ·{" "}
              {comparison.sourceCommit.slice(0, 8)}
            </code>
          </div>
          {comparison.diffs.length === 0 ? (
            <p className="p-6 text-sm text-emerald-300/70">
              该英雄在首期比较字段中没有差异。
            </p>
          ) : (
            <div className="divide-y divide-white/7">
              {comparison.diffs.map((diff) => (
                <div
                  key={`${diff.field_name}-${diff.diff_type}`}
                  className="grid gap-3 p-4 text-xs sm:grid-cols-[170px_1fr_1fr]"
                >
                  <div>
                    <p className="font-mono text-zinc-300">{diff.field_name}</p>
                    <p className="mt-1 text-[9px] uppercase tracking-wider text-amber-500/70">
                      {diff.diff_type}
                    </p>
                  </div>
                  <DiffValue label="VPK 规范" value={diff.canonical_value} />
                  <DiffValue label="reference" value={diff.reference_value} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function DiffValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-zinc-700">
        {label}
      </p>
      <code className="mt-1 block break-all text-[10px] text-zinc-400">
        {JSON.stringify(value)}
      </code>
    </div>
  );
}

function formatValue(value: unknown): string {
  const text = String(value ?? "—");
  return /^-?\d+\.\d+$/u.test(text)
    ? text.replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1")
    : text;
}

function cleanUpstreamText(value: string): string {
  return value.replace(/<\/?b>/giu, "");
}
