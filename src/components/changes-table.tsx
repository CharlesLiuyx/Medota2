"use client";
import {
  Info,
  ArrowDown,
  ArrowUp,
  Minus,
  FileText,
  CircleHelp,
} from "lucide-react";
import { useMemo } from "react";
import { useLocale, useTranslations } from "@/i18n/provider";
import type { EntityPreview } from "@/presentation/entity-preview";
import {
  EntityReference,
  EntityText,
  EntityReferenceWidthSample,
} from "./entity-reference";
import { HoverTooltip } from "./ui/hover-tooltip";
import { GroupedTable, type GroupedTableColumn } from "./ui/grouped-table";
import {
  CHANGE_TABLE_KINDS,
  CHANGE_DIRECTION_ORDER,
  changeSubjectKey,
  type ChangeTableGroup,
  type ChangeTableRow,
  type ChangeTableKind,
} from "@/presentation/changes-table";
import styles from "./changes-table.module.css";
const directionLabels = { nerf: "削弱", buff: "增强", neutral: "持平" };
const directionIcons = { nerf: ArrowDown, buff: ArrowUp, neutral: Minus };
const kindLabels = {
  mechanism: "机制",
  hero: "英雄",
  item: "物品",
  other: "其他",
};
function Impact({ row }: { row: ChangeTableRow }) {
  const t = useTranslations();
  const locale = useLocale();
  const impact = row.impact;
  const name = directionLabels[impact.direction];
  const Icon = impact.pending
    ? CircleHelp
    : impact.direction === "buff"
      ? ArrowUp
      : impact.direction === "nerf"
        ? ArrowDown
        : Minus;
  const percent =
    impact.percent === null
      ? "—"
      : `${impact.percent > 0 ? "+" : ""}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(impact.percent)}%`;
  const deltas = impact.delta?.values;
  const distinct = deltas?.every((value) => value === deltas[0])
    ? deltas.slice(0, 1)
    : deltas;
  const deltaText = distinct
    ? distinct
        .map((value) =>
          new Intl.NumberFormat(locale, {
            signDisplay: "exceptZero",
            maximumSignificantDigits: 12,
            useGrouping: false,
          }).format(value),
        )
        .join(" / ") +
      (impact.delta?.unit === "percentagePoints"
        ? ` ${t("百分点")}`
        : impact.delta?.unit === "seconds"
          ? t(" 秒")
          : "")
    : "—";
  return (
    <HoverTooltip
      className={`${styles.impact} ${styles[impact.direction]}`}

      content={
        <div className="space-y-2">
          <strong>
            {t(name)}
            {impact.pending
              ? ` · ${t("待判断")}`
              : impact.mixed
                ? ` · ${t("各等级有增有减")}`
                : ""}
          </strong>
          <p>{t(impact.rule)}</p>
          <p>
            {t("实际差值")}：{deltaText}
          </p>
          <p>
            {t(
              "差值为终点减起点，多等级逐级计算；相同差值合并显示，百分比属性使用百分点。",
            )}
          </p>
          {impact.basis && (
            <p>
              {t("按条件生效后的数值比较")}：{impact.basis.before} →{" "}
              {impact.basis.after}
            </p>
          )}
          <p>
            {t(
              "幅度为各等级数值变化率的均值，以旧值绝对值为分母；旧值为零时不计算百分比。",
            )}
          </p>
          <p>
            {t(
              "排序结合控制、冷却、经济等作用、变化尺度及天赋条件；估算优先级不代表胜率或整体强度变化。",
            )}
          </p>
          <p className="text-[var(--text-muted)]">
            {t("影响优先级")} · {impact.score.toFixed(1)}
          </p>
        </div>
      }
    >
      <span className={styles.direction}>
        <Icon aria-hidden="true" className="size-3" />
        {t(name)}
        {impact.pending ? " ?" : impact.mixed ? " ±" : ""}
      </span>
      <span className={styles.percent}>{percent}</span>
      <span
        className={styles.delta}
        data-change-delta=""
        aria-label={`${t("实际差值")}：${deltaText}`}
      >
        Δ {deltaText}
      </span>
    </HoverTooltip>
  );
}
function Sources({
  row,
  sourceUrl,
}: {
  row: ChangeTableRow;
  sourceUrl?: string;
}) {
  const t = useTranslations();
  return (
    <HoverTooltip
      className={styles.source}

      content={
        <div className="space-y-3">
          <strong>{t("变化依据")}</strong>
          {row.notes.length > 0 && (
            <div>
              <p className="mb-1 text-[var(--text-muted)]">
                {t("官方更新说明")}
              </p>
              {row.notes.map((note, i) => (
                <p key={i}>
                  {note.text}
                  {note.detail ? ` · ${note.detail}` : ""}
                </p>
              ))}
              {sourceUrl && (
                <a
                  className="mt-2 inline-block underline"
                  href={
                    row.notes.find((note) => note.sourceUrl)?.sourceUrl ??
                    sourceUrl
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("官方更新说明")} ↗
                </a>
              )}
            </div>
          )}
          {!row.evidence.length && (
            <p>{t("此项未展示对应数值差异，需进一步核对；保留官方说明。")}</p>
          )}
          {row.evidence.map((e, i) => (
            <div key={i} className="break-words text-[11px]">
              <p>{e.path}</p>
              {[
                [t("起始版本"), e.beforeSources],
                [t("所选版本"), e.afterSources],
              ].map(([name, sources]) => (
                <div key={String(name)}>
                  <strong>{String(name)}</strong>
                  {(sources as typeof e.beforeSources).map((s, j) => (
                    <p key={j} className="text-[var(--text-muted)]">
                      {s.repository} · {s.path}
                      {s.line ? `:${s.line}` : ""}
                      <br />
                      {s.commit ?? s.sha256 ?? "—"}
                    </p>
                  ))}
                </div>
              ))}
              <details>
                <summary>{t("查看原始字段与来源")}</summary>
                <pre className="whitespace-pre-wrap break-all">
                  {JSON.stringify(e, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      }
    >
      <FileText aria-hidden="true" className="size-3.5" />
      <span
        className="sr-only"
        lang={row.sourceLocale}
        data-source-text={row.sourceLocale ? "" : undefined}
      >
        {t("变化依据")} · {row.entity.name} · {row.label}
      </span>
    </HoverTooltip>
  );
}
function entityCellKey(entity: EntityPreview) {
  return `entity:${JSON.stringify(entity)}`;
}
function Table({
  groups,
  kind,
  identity,
  before,
  after,
  sourceUrl,
  references,
}: {
  references: EntityPreview[];
  groups: ChangeTableGroup[];
  kind: ChangeTableKind;
  identity: string;
  before: string;
  after: string;
  sourceUrl?: string;
}) {
  const t = useTranslations();
  const count = groups.reduce((n, group) => n + group.rows.length, 0);
  const counts = Object.fromEntries(
    CHANGE_DIRECTION_ORDER.map((direction) => [
      direction,
      groups.reduce(
        (total, group) =>
          total +
          group.rows.filter((row) => row.impact.direction === direction).length,
        0,
      ),
    ]),
  );
  const widthSamples = (entities: EntityPreview[]) =>
    [
      ...new Map(
        entities.map((entity) => [`${entity.kind}:${entity.name}`, entity]),
      ).values(),
    ].map((entity) => (
      <div key={`${entity.kind}:${entity.name}`}>
        <EntityReferenceWidthSample entity={entity} />
      </div>
    ));
  const columns: GroupedTableColumn<ChangeTableGroup, ChangeTableRow>[] = [
    {
      key: "number",
      header: "#",
      width: 40,
      className: styles.number,
      render: (_row, group, index) => group.start + index,
    },
    {
      key: "owner",
      header: t(kind === "hero" ? "英雄" : "对象"),
      widthSample: widthSamples(groups.map((group) => group.entity)),
      fitContent: true,
      maxContentWidth: 200,
      merged: true,
      mergeKey: (_row, group) => entityCellKey(group.entity),
      render: (_row, group) => <EntityReference entity={group.entity} inline />,
    },
    {
      key: "subject",
      header: t("改动项"),
      mergeKey: (row) => entityCellKey(row.entity),
      widthSample: widthSamples(
        groups.flatMap((group) => group.rows.map((row) => row.entity)),
      ),
      fitContent: true,
      maxContentWidth: 200,
      render: (row) => <EntityReference entity={row.entity} inline />,
    },
    {
      key: "detail",
      header: t("详情"),
      className: styles.detail,
      mergeKey: (row) =>
        row.property
          ? `${row.impact.direction}:${entityCellKey(row.property)}`
          : `text:${row.impact.direction}:${row.sourceLocale ?? ""}:${row.label}`,
      render: (row) =>
        row.property ? (
          <EntityReference entity={row.property} icon={false} inline />
        ) : (
          <span
            lang={row.sourceLocale}
            data-source-text={row.sourceLocale ? "" : undefined}
          >
            <EntityText text={row.label} entities={references} />
          </span>
        ),
    },
    {
      key: "before",
      header: before,
      mergeKey: (row) =>
        `text:${row.impact.direction}:${row.sourceLocale ?? ""}:${row.before ?? "—"}`,
      width: "clamp(200px, 16vw, 280px)",
      fitContent: true,
      maxContentWidth: 260,
      className: styles.before,
      cellProps: (row) => ({
        "data-change-before": "",
        lang: row.sourceLocale,
        "data-source-text": row.sourceLocale ? "" : undefined,
      }),
      render: (row) => (
        <EntityText text={row.before ?? "—"} entities={references} />
      ),
    },
    {
      key: "after",
      header: after,
      mergeKey: (row) =>
        `text:${row.impact.direction}:${row.sourceLocale ?? ""}:${row.after ?? "—"}`,
      width: "clamp(200px, 16vw, 280px)",
      fitContent: true,
      maxContentWidth: 260,
      className: styles.after,
      cellProps: (row) => ({
        "data-change-after": "",
        lang: row.sourceLocale,
        "data-source-text": row.sourceLocale ? "" : undefined,
      }),
      render: (row) => (
        <EntityText text={row.after ?? "—"} entities={references} />
      ),
    },
    {
      key: "impact",
      header: t("方向 / 幅度 / 差值"),
      width: "clamp(230px, 21vw, 320px)",
      mergeKey: (row) => `impact:${JSON.stringify(row.impact)}`,
      render: (row) => <Impact row={row} />,
    },
    {
      key: "source",
      mergeKey: (row) =>
        `source:${JSON.stringify([row.entity.name, row.label, row.sourceLocale, row.evidence, row.notes, sourceUrl])}`,
      header: (
        <>
          <Info aria-hidden="true" className="size-3" />
          <span className="sr-only">{t("来源")}</span>
        </>
      ),
      width: 32,
      render: (row) => <Sources row={row} sourceUrl={sourceUrl} />,
    },
  ];
  return (
    <section className={styles.section} aria-label={t(kindLabels[kind])}>
      <h2 className={styles.heading}>
        {t(kindLabels[kind])}
        <span>{count}</span>
        {!!count && (
          <span className={styles.legend}>
            {CHANGE_DIRECTION_ORDER.filter(
              (direction) => counts[direction],
            ).map((direction) => {
              const Icon = directionIcons[direction];
              return (
                <span key={direction} data-direction-count={direction}>
                  <Icon aria-hidden="true" />
                  {t(directionLabels[direction])} {counts[direction]}
                </span>
              );
            })}
          </span>
        )}
      </h2>
      <GroupedTable
        groups={groups}
        columns={columns}
        identity={`${identity}:${kind}`}
        label={t(kindLabels[kind])}
        minWidth={1200}
        rowKey={(row) => row.key}
        groupProps={(group) => ({ "data-change-group": group.key })}
        rowProps={(row, group, index) => ({
          className: styles.directionRow,
          "data-direction-start":
            index === 0 ||
            changeSubjectKey(group.rows[index - 1]) !== changeSubjectKey(row) ||
            group.rows[index - 1].impact.direction !== row.impact.direction
              ? ""
              : undefined,
          "data-change-row": "",
          "data-change-subject": changeSubjectKey(row),
          "data-impact-score": row.impact.score,
          "data-direction": row.impact.direction,
        })}
        empty={<p className={styles.empty}>{t("没有可确认的变化")}</p>}
      />
    </section>
  );
}

export function ChangesTable({
  groups,
  ...props
}: {
  groups: ChangeTableGroup[];
  identity: string;
  before: string;
  after: string;
  sourceUrl?: string;
  references: EntityPreview[];
}) {
  const sections = useMemo(
    () =>
      CHANGE_TABLE_KINDS.map((kind) => ({
        kind,
        groups: groups.filter((group) => group.kind === kind),
      })),
    [groups],
  );
  return (
    <div className={styles.tables}>
      {sections.map((section) => (
        <Table
          key={`${props.identity}:${section.kind}`}
          {...props}
          {...section}
        />
      ))}
    </div>
  );
}
