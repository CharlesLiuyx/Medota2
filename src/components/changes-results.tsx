"use client";

import { useMemo, type ComponentProps, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "@/i18n/provider";
import {
  CHANGE_TABLE_KINDS,
  orderChangeRows,
} from "@/presentation/changes-table";
import { ChangesTable } from "./changes-table";

export function ChangesResults({
  groups,
  identity,
  audit,
  sameVersion,
  noChanges,
  ...props
}: ComponentProps<typeof ChangesTable> & {
  audit: ReactNode;
  sameVersion: boolean;
  noChanges: boolean;
}) {
  const t = useTranslations();
  const params = useSearchParams();
  const kind = params.get("entity") ?? "all";
  const category = params.get("category") ?? "all";
  const query = (params.get("q") ?? "").trim().slice(0, 100).toLowerCase();
  const filtered = useMemo(() => {
    const primary = CHANGE_TABLE_KINDS.some((value) => value === kind);
    const direction = ["buff", "nerf", "neutral"].includes(category);
    const contains = (text?: string) => text?.toLowerCase().includes(query);
    const result = groups
      .filter((group) => !primary || group.kind === kind)
      .map((group) => ({
        ...group,
        rows: orderChangeRows(
          group.rows.filter(
            (row) =>
              (kind === "all" ||
                primary ||
                row.evidence.some((e) => e.entityType === kind) ||
                (kind === "ability" && row.entity.kind === "ability")) &&
              (category === "all" ||
                (direction
                  ? row.impact.direction === category
                  : row.category === category)) &&
              (!query ||
                contains(group.entity.name) ||
                [row.entity.name, row.label, row.before, row.after].some(
                  contains,
                ) ||
                row.notes.some((note) => contains(note.text))),
          ),
        ),
      }))
      .filter((group) => group.rows.length)
      .map((group) => ({
        ...group,
        score: Math.max(...group.rows.map((row) => row.impact.score)),
      }))
      .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    let ordinal = 1;
    for (const kind of CHANGE_TABLE_KINDS)
      for (const group of result.filter((group) => group.kind === kind)) {
        group.start = ordinal;
        ordinal += group.rows.length;
      }
    return { groups: result, count: ordinal - 1 };
  }, [groups, kind, category, query]);
  return (
    <>
      <div className="mt-3 flex items-center gap-2 text-xs text-[var(--text-secondary)]">
        <p role="status">
          {sameVersion
            ? t("起始与目标为同一版本。")
            : t("{value0} 个对象 · {value1} 项可读数据变化", {
                value0: filtered.groups.length,
                value1: filtered.count,
              })}
        </p>
        {audit}
      </div>
      <ChangesTable
        {...props}
        groups={filtered.groups}
        identity={`${identity}:${kind}:${category}:${query}`}
      />
      {!filtered.count && (
        <p className="py-8 text-sm text-[var(--text-secondary)]">
          {noChanges
            ? t("所选范围没有可确认的端点变化。")
            : t("没有符合筛选的可读变化；未解释的记录保留在原始资料中。")}
        </p>
      )}
    </>
  );
}
