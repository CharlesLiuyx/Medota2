import { releaseLabel } from "@/presentation/releases";
import { diagnosticText } from "@/i18n/diagnostics";
import { LocalizedText, Message } from "@/i18n/provider";
import { getTranslations } from "@/i18n/server";

import { getRequestLocale } from "@/i18n/server";

import { canonicalReleaseId } from "@/domain/releases";
import { CompactSelect } from "@/components/ui/compact-select";
import type { Metadata } from "next";
import Link from "@/components/version-link";
import { notFound } from "next/navigation";
import {
  ENTITY_KINDS,
  type EntityVersionChange,
} from "@/domain/entity-version-diff";
import {
  getReleaseIndex,
  resolvePageRelease,
} from "@/server/services/releases";
import { getEntityVersionDiff } from "@/server/services/entity-version-diff";
import { getReleaseChangesView } from "@/server/services/release-changes";
import type { SearchParams } from "@/server/services/hero-filters";
import type { ReadableChange } from "@/presentation/entity-changes";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("版本变化") };
}
export const dynamic = "force-dynamic";
const kindNames = {
  hero: "英雄",
  ability: "技能",
  item: "物品与附魔",
  facet: "命石",
  unit: "单位",
  map_object: "地图对象",
  map_region: "地图区域",
  relation: "关系",
  mechanism: "机制",
  localization: "文字说明",
  asset_binding: "图片",
  source_structure: "原始资料",
};
const categories = {
  entity: "新增或移除",
  property: "属性",
  relation: "关系",
  mechanism: "机制",
  source_structure: "原始资料",
};
async function Evidence({ changes }: { changes: EntityVersionChange[] }) {
  const t = await getTranslations();
  return (
    <details className="change-evidence">
      <summary>{t("查看原始字段与来源")}</summary>
      <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[10px]">
        {JSON.stringify(changes, null, 2)}
      </pre>
    </details>
  );
}
async function ValueTable({
  rows,
  from,
  to,
}: {
  rows: ReadableChange[];
  from: string;
  to: string;
}) {
  const t = await getTranslations();
  const locale = await getRequestLocale();
  return (
    <div className="change-values">
      <div className="change-value-head">
        <span>{t("数据差异")}</span>
        <span>{from}</span>
        <span>{to}</span>
      </div>
      {rows.map((row, i) => (
        <div className="change-value-entry" key={`${row.label}:${i}`}>
          <div className="change-value-row">
            <span>
              {row.label}
              {row.sourceLocale && row.sourceLocale !== locale && (
                <small className="block text-[var(--text-muted)]">
                  {t("原文：{language}", {
                    language: t(row.sourceLocale === "en" ? "英文" : "中文"),
                  })}
                </small>
              )}
            </span>
            <span
              className="change-before"
              lang={row.sourceLocale}
              data-source-text={row.sourceLocale ? "" : undefined}
            >
              {row.before}
            </span>
            <span
              className="change-after"
              lang={row.sourceLocale}
              data-source-text={row.sourceLocale ? "" : undefined}
            >
              <span aria-hidden="true" className="change-arrow">
                →
              </span>
              {row.after}
            </span>
          </div>
          <Evidence changes={row.evidence} />
        </div>
      ))}
    </div>
  );
}
export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const t = await getTranslations();
  const locale = await getRequestLocale();
  const params = await searchParams;
  const selected = await resolvePageRelease("/changes", params);
  const index = await getReleaseIndex();
  if (!selected) return <main className="p-8">{t("版本资料尚未收录。")}</main>;
  const read = (key: string) => {
    const value = params[key];
    if (Array.isArray(value)) notFound();
    return value;
  };
  const fromId =
    (read("from") ? canonicalReleaseId(index, read("from")!) : undefined) ??
    index.releases.find((r) => r.id !== selected.id)?.id ??
    selected.id;
  const from = index.releases.find((r) => r.id === fromId);
  if (!from) notFound();
  const kind = read("entity") ?? "all",
    category = read("category") ?? "all",
    query = (read("q") ?? "").trim().slice(0, 100);
  if (
    kind !== "all" &&
    kind !== "item" &&
    !(ENTITY_KINDS as readonly string[]).includes(kind)
  )
    notFound();
  if (category !== "all" && !Object.hasOwn(categories, category)) notFound();
  const rawPage = read("page") ?? "1",
    rawReviewPage = read("reviewPage") ?? "1";
  if (
    !/^[1-9]\d{0,5}$/u.test(rawPage) ||
    !/^[1-9]\d{0,5}$/u.test(rawReviewPage)
  )
    notFound();
  const page = Number(rawPage),
    reviewPage = Number(rawReviewPage);
  const diff = await getEntityVersionDiff(from.id, selected.id);
  const view = await getReleaseChangesView(
    from,
    selected,
    diff.changes,
    locale,
  );
  const matches = (c: EntityVersionChange) =>
    (kind === "all" ||
      c.entityType === kind ||
      (kind === "item" && c.entityKey.startsWith("item_"))) &&
    (category === "all" || c.category === category);
  const groups = view.groups
    .map((group) => ({
      ...group,
      sections: group.sections
        .map((section) => ({
          ...section,
          notes:
            category === "all" &&
            (kind === "all" ||
              (kind === "item" && group.kind === "item") ||
              (kind === "hero" &&
                group.kind === "hero" &&
                section.key === group.key) ||
              (kind === "ability" &&
                group.kind !== "item" &&
                section.key !== group.key))
              ? section.notes
              : [],
          rows: section.rows.filter((row) => row.evidence.some(matches)),
        }))
        .filter((section) => section.notes.length || section.rows.length),
    }))
    .filter(
      (group) =>
        group.sections.length &&
        (!query ||
          [group.name, ...group.sections.map((s) => s.name)].some((name) =>
            name.toLowerCase().includes(query.toLowerCase()),
          )),
    );
  const technical = view.technical.filter(matches);
  const visible = groups.slice((page - 1) * 25, page * 25);
  const link = (p: number, review = reviewPage) =>
    `/changes?${new URLSearchParams({ lang: locale, release: selected.id, from: fromId, entity: kind, category, q: query, page: String(p), reviewPage: String(review) })}`;
  const totalRows = groups.reduce(
    (sum, g) => sum + g.sections.reduce((n, s) => n + s.rows.length, 0),
    0,
  );
  const beforeLabel = from.patch ?? t("起始版本"),
    afterLabel = selected.patch ?? t("所选版本");
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">
          <LocalizedText>版本变化</LocalizedText>
        </h1>
        <p className="text-sm text-[var(--text-secondary)]">
          {beforeLabel} <span className="px-2 text-[var(--text-muted)]">→</span>{" "}
          {afterLabel}
        </p>
      </div>
      <p className="mt-2 text-xs text-[var(--text-muted)]">
        {t("按英雄、技能和物品查看前后变化。数值按技能等级顺序排列。")}
      </p>
      <form
        action="/changes"
        className="mt-4 flex flex-wrap items-center gap-3 text-xs"
      >
        <input type="hidden" name="release" value={selected.id} />
        <input type="hidden" name="lang" value={locale} />
        <CompactSelect
          key={`from:${fromId}`}
          label={t("起始版本")}
          name="from"
          defaultValue={fromId}
        >
          {index.releases.map((r) => (
            <option key={r.id} value={r.id}>
              {releaseLabel(r, locale)}
            </option>
          ))}
        </CompactSelect>
        <CompactSelect
          key={`entity:${kind}`}
          label={t("对象")}
          name="entity"
          defaultValue={kind}
        >
          <option value="all">{t("全部")}</option>
          {[...ENTITY_KINDS, "item" as const].map((k) => (
            <option key={k} value={k}>
              {t(kindNames[k])}
            </option>
          ))}
        </CompactSelect>
        <CompactSelect
          key={`category:${category}`}
          label={t("变化")}
          name="category"
          defaultValue={category}
        >
          <option value="all">{t("全部")}</option>
          {Object.entries(categories).map(([k, n]) => (
            <option key={k} value={k}>
              {t(n)}
            </option>
          ))}
        </CompactSelect>
        <input
          type="search"
          name="q"
          defaultValue={query}
          aria-label={t("搜索变化")}
          placeholder={t("搜索英雄、技能、物品")}
          className="change-search"
        />
        <button className="border border-white/20 px-3 py-2">
          {t("比较")}
        </button>
      </form>
      <div className="change-overview">
        <p role="status" className="text-sm">
          {from.id === selected.id
            ? t("同一版本，没有端点变化")
            : t("{value0} 个对象 · {value1} 项可读数据变化", {
                value0: groups.length,
                value1: totalRows,
              })}
        </p>
        {view.patch ? (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            <Message
              id="已结合 {value0}。更新说明与两版收录数据并列展示，各项数据保留原始来源。"
              values={{
                value0: (
                  <a
                    href={view.patch.source.page}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[var(--accent-primary)] underline underline-offset-2"
                  >
                    <Message
                      id="{value0} 官方更新说明 ↗"
                      values={{
                        value0: afterLabel,
                      }}
                    />
                  </a>
                ),
              }}
            />
          </p>
        ) : (
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {t(
              "当前版本组合展示两端数据差异。官方说明仅用于已核对的对应更新。",
            )}
          </p>
        )}
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {diff.status === "partial" || diff.status === "incomparable"
            ? t("地图身份、完整脚本及部分规则仍待核验，详见页末比较范围。")
            : t("前后值来自所选的两个完整版本。")}
        </p>
      </div>
      <div className="mt-4 space-y-4">
        {visible.map((group) => (
          <article
            className="change-group"
            key={group.key}
            data-change-group={group.key}
          >
            <header className="change-group-heading">
              <h2>
                {group.href ? (
                  <Link href={group.href}>{group.name}</Link>
                ) : (
                  group.name
                )}
              </h2>
              <span>
                {group.kind === "item"
                  ? t("物品／附魔")
                  : t(kindNames[group.kind])}
              </span>
            </header>
            {group.sections.map((section) => (
              <section key={section.key} className="change-section">
                <h3 className="change-section-heading">
                  {section.href && section.key !== group.key ? (
                    <Link href={section.href}>{section.name}</Link>
                  ) : (
                    section.name
                  )}
                </h3>
                <div
                  className={`change-section-body ${section.notes.length && section.rows.length ? "change-with-notes" : ""}`}
                >
                  {section.notes.length > 0 && (
                    <div className="change-notes">
                      <p className="change-column-label">{t("官方更新说明")}</p>
                      <ul>
                        {section.notes.map((note, i) => (
                          <li key={i}>
                            {note.upgrade && (
                              <span className="change-upgrade">
                                {note.upgrade === "scepter"
                                  ? t("神杖")
                                  : t("魔晶")}{" "}
                                ·{" "}
                              </span>
                            )}
                            {note.text}
                            {note.detail && (
                              <span className="block text-[var(--text-muted)]">
                                {note.detail}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {!section.rows.length && (
                        <p className="mt-2 text-[10px] text-[var(--text-muted)]">
                          {t(
                            "此项未展示对应数值差异，需进一步核对；保留官方说明。",
                          )}
                        </p>
                      )}
                    </div>
                  )}
                  {section.rows.length > 0 && (
                    <ValueTable
                      rows={section.rows}
                      from={beforeLabel}
                      to={afterLabel}
                    />
                  )}
                </div>
              </section>
            ))}
          </article>
        ))}
      </div>
      {groups.length === 0 && (
        <p className="py-8 text-sm text-[var(--text-secondary)]">
          {diff.changes.length === 0
            ? t("所选范围没有可确认的端点变化。")
            : t("没有符合筛选的可读变化；未解释的记录保留在原始资料中。")}
        </p>
      )}
      {groups.length > 25 && (
        <nav
          className="mt-4 flex items-center gap-4 text-xs"
          aria-label={t("变化分页")}
        >
          <span>
            <Message
              id="第 {value0} / {value1} 页"
              values={{
                value0: page,
                value1: Math.ceil(groups.length / 25),
              }}
            />
          </span>
          {[page - 1, page + 1]
            .filter((p) => p > 0 && (p - 1) * 25 < groups.length)
            .map((p) => (
              <Link key={p} href={link(p)}>
                {p < page ? t("上一页") : t("下一页")}
              </Link>
            ))}
        </nav>
      )}
      {view.patch && kind === "all" && category === "all" && !query && (
        <details className="change-appendix">
          <summary>
            <Message
              id="官方同时公布的问题修复（{value0} 项）"
              values={{
                value0: view.patch.fixes.length,
              }}
            />
          </summary>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {t("这些行为需要脚本或引擎验证，不能仅凭数值定义确认。")}
          </p>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {t("原文：{language}", { language: t("中文") })}
          </p>
          <ul
            lang="zh-CN"
            data-source-text=""
            className="mt-2 list-inside list-disc space-y-1 text-xs"
          >
            {view.patch.fixes.map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
          <a
            href={view.patch.fixesSource.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs underline"
          >
            {t("官方修复公告 ↗")}
          </a>
        </details>
      )}
      <details className="change-appendix">
        <summary>{t("比较范围与待核验内容")}</summary>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          <Message
            id="{value0} 条结构化记录；{value1} 条身份或覆盖待核对记录。数值的两种存储形式、重复的规则投影合并展示，原始记录全部保留。"
            values={{
              value0: diff.changes.length + view.itemRecordCount,
              value1: diff.unresolved.length,
            }}
          />
        </p>
        <ul className="mt-2 space-y-1 text-xs text-[var(--text-muted)]">
          {diff.coverage.map((c) => (
            <li key={c.entityType}>
              {t(kindNames[c.entityType])}：
              {c.status === "comparable"
                ? t("可比较")
                : c.status === "partial"
                  ? t("部分可比较")
                  : t("无法比较")}
              {c.reason ? ` · ${diagnosticText(locale, c.reason)}` : ""}
            </li>
          ))}
        </ul>
        {diff.implementationChanges && (
          <details className="mt-3 text-xs">
            <summary>{t("资料解析方式的变化")}</summary>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all">
              {JSON.stringify(diff.implementationChanges, null, 2)}
            </pre>
          </details>
        )}
        <details className="mt-3 text-xs">
          <summary>
            <Message
              id="待核对记录（{value0}）"
              values={{
                value0: diff.unresolved.length,
              }}
            />
          </summary>
          {diff.unresolved
            .slice((reviewPage - 1) * 50, reviewPage * 50)
            .map((u, i) => (
              <details key={i} className="mt-2">
                <summary>
                  {t(kindNames[u.entityType])} ·{" "}
                  {diagnosticText(locale, u.reason)}
                </summary>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(u, null, 2)}
                </pre>
              </details>
            ))}
          <div className="mt-3 flex gap-4">
            {[reviewPage - 1, reviewPage + 1]
              .filter((p) => p > 0 && (p - 1) * 50 < diff.unresolved.length)
              .map((p) => (
                <Link key={p} href={link(page, p)}>
                  {p < reviewPage ? t("上一页待核对") : t("下一页待核对")}
                </Link>
              ))}
          </div>
        </details>
      </details>
      <details className="change-appendix">
        <summary>
          <Message
            id="原始资料及尚未解释的变化（{value0}）"
            values={{
              value0: technical.length,
            }}
          />
        </summary>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {t("保留尚未确认含义的字段、文件结构和图片记录，供进一步核对。")}
        </p>
        {technical.slice((reviewPage - 1) * 50, reviewPage * 50).map((c, i) => (
          <details className="mt-3 text-xs" key={i}>
            <summary>
              {t(kindNames[c.entityType])} · {c.entityKey} ·{" "}
              {c.path || t("完整对象")}
            </summary>
            <Evidence changes={[c]} />
          </details>
        ))}
        <div className="mt-3 flex gap-4 text-xs">
          {[reviewPage - 1, reviewPage + 1]
            .filter((p) => p > 0 && (p - 1) * 50 < technical.length)
            .map((p) => (
              <Link key={p} href={link(page, p)}>
                {p < reviewPage ? t("上一页原始资料") : t("下一页原始资料")}
              </Link>
            ))}
        </div>
      </details>
    </main>
  );
}
