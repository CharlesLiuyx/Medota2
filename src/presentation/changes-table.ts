import type { ChangeGroup, PatchNote } from "@/server/services/release-changes";
import type { ReadableChange } from "./entity-changes";
import type { EntityPreview } from "./entity-preview";
import { noteCovered, noteEndpoints, noteField } from "./change-notes";
import { assessChange, type ChangeImpact } from "./change-impact";
import { attributeDefinition, attributeId } from "@/domain/attributes";
import { createTranslator } from "@/i18n/messages";
import type { Locale } from "@/i18n/locale";
export const CHANGE_DIRECTION_ORDER = ["nerf", "buff", "neutral"] as const;
export const CHANGE_TABLE_KINDS = [
  "mechanism",
  "hero",
  "item",
  "other",
] as const;
export type ChangeTableKind = (typeof CHANGE_TABLE_KINDS)[number];
export interface ChangeTableRow {
  key: string;
  entity: EntityPreview;
  property?: EntityPreview;
  label: string;
  before?: string;
  after?: string;
  notes: PatchNote[];
  evidence: ReadableChange["evidence"];
  impact: ChangeImpact;
  category: string;
  sourceLocale?: "zh-CN" | "en";
}
export interface ChangeTableGroup {
  key: string;
  entity: EntityPreview;
  kind: ChangeTableKind;
  rows: ChangeTableRow[];
  score: number;
  start: number;
}
/** Stable subject identity; display names alone do not identify an entity. */
export function changeSubjectKey(row: Pick<ChangeTableRow, "entity">): string {
  return JSON.stringify([row.entity.kind, row.entity.key]);
}

/** Keep a subject together across benefit directions, including after filtering. */
export function orderChangeRows(rows: ChangeTableRow[]): ChangeTableRow[] {
  const subjects = new Map<
    string,
    { key: string; score: number; rows: ChangeTableRow[] }
  >();
  for (const row of rows) {
    const key = changeSubjectKey(row);
    const subject = subjects.get(key) ?? { key, score: 0, rows: [] };
    subject.rows.push(row);
    subject.score = Math.max(subject.score, row.impact.score);
    subjects.set(key, subject);
  }
  return [...subjects.values()]
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
    .flatMap((subject) =>
      subject.rows.sort(
        (a, b) =>
          CHANGE_DIRECTION_ORDER.indexOf(a.impact.direction) -
            CHANGE_DIRECTION_ORDER.indexOf(b.impact.direction) ||
          b.impact.score - a.impact.score ||
          a.key.localeCompare(b.key),
      ),
    );
}

export function changeTableGroups(
  groups: ChangeGroup[],
  locale: Locale,
): ChangeTableGroup[] {
  const t = createTranslator(locale);
  const result = groups
    .map((group) => {
      const kind: ChangeTableKind =
        group.kind === "ability" || group.kind === "unit"
          ? "other"
          : group.kind;
      const entity: EntityPreview = group.entity ?? {
        key: group.key,
        name: group.name,
        href: group.href,
        kind: group.kind,
      };
      const rows = orderChangeRows(
        group.sections.flatMap((section) => {
          const subject: EntityPreview = section.entity ?? {
            ...entity,
            key: section.key,
            kind: section.key.startsWith("talents:")
              ? "attribute"
              : entity.kind,
            icon: section.key.startsWith("talents:") ? undefined : entity.icon,
            name: section.name,
            href: section.href,
          };
          const measured: ChangeTableRow[] = section.rows.map((row, i) => {
            const ownerKind =
              row.kind === "unit"
                ? "unit"
                : row.subject.key.startsWith("item_")
                  ? "item"
                  : row.subject.heroKey
                    ? "ability"
                    : group.kind === "hero" && row.subject.key === group.key
                      ? "hero"
                      : "ability";
            const id = row.field
              ? attributeId(ownerKind, row.subject.key, row.field)
              : undefined;
            const definition = id ? attributeDefinition(id) : undefined;
            return {
              key: `${section.key}:${i}`,
              category: row.category,
              entity:
                row.subject.key === group.key && group.kind === "hero"
                  ? {
                      ...entity,
                      key: `${group.key}:base`,
                      name: t("基础属性"),
                      kind: "attribute",
                      icon: undefined,
                    }
                  : (row.subject.preview ?? subject),
              label: t(row.label),
              property: id
                ? {
                    key: id,
                    name: t(row.label),
                    kind: "attribute",
                    href: row.field?.startsWith("has_")
                      ? undefined
                      : `/attributes/${encodeURIComponent(id)}`,
                    description: definition
                      ? t(definition.summary)
                      : t(
                          "该对象的专属参数；具体作用以同版本技能或物品说明为准。",
                        ),
                    facts: [
                      { label: t("起始版本"), value: row.before },
                      { label: t("所选版本"), value: row.after },
                    ],
                  }
                : undefined,
              before: row.before,
              after: row.after,
              notes: section.notes,
              evidence: row.evidence,
              impact: assessChange(row),
              sourceLocale: row.sourceLocale,
            };
          });
          return [
            ...measured,
            ...section.notes
              .filter((note) => !noteCovered(note, section.rows))
              .map((note, i): ChangeTableRow => {
                const endpoint = noteEndpoints(note);
                const field = endpoint ? noteField(endpoint.label) : undefined;
                const noteRow: ReadableChange = {
                  subject: { key: section.key, name: section.name },
                  field,
                  label: endpoint?.label ?? note.text,
                  before: endpoint?.before ?? "",
                  after: endpoint?.after ?? "",
                  kind: group.kind,
                  category: "property",
                  evidence: [],
                };
                return {
                  key: `${section.key}:note:${i}`,
                  category: "property",
                  entity: subject,
                  label: `${note.upgrade ? `${t(note.upgrade === "scepter" ? "神杖" : "魔晶")} · ` : ""}${t(endpoint?.label ?? note.text)}`,
                  before: endpoint?.before,
                  after: endpoint?.after,
                  notes: [note],
                  sourceLocale: note.sourceLocale,
                  evidence: [],
                  impact: endpoint
                    ? assessChange(noteRow)
                    : {
                        direction: "neutral",
                        percent: null,
                        score: 0,
                        pending: true,
                        rule: "官方说明尚未对应可比较数值，收益方向待核定",
                      },
                };
              }),
          ];
        }),
      );
      return {
        key: group.key,
        entity,
        kind,
        rows,
        score: Math.max(0, ...rows.map((row) => row.impact.score)),
        start: 0,
      };
    })
    .filter((group) => group.rows.length)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  let index = 1;
  for (const kind of CHANGE_TABLE_KINDS)
    for (const group of result.filter((g) => g.kind === kind)) {
      group.start = index;
      index += group.rows.length;
    }
  return result;
}
