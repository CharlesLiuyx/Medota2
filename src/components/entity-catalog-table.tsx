"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowUpDown } from "lucide-react";
import { HERO_DEFAULT_TABLE_COLUMNS } from "@/presentation/catalog-table-columns";
import { CatalogTableHeader } from "./catalog-table-header";
import headerStyles from "./catalog-table-header.module.css";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "@/i18n/provider";
import {
  sortCatalogRows,
  catalogNumericValue,
  formatCatalogNumberText,
  type CatalogSortValue,
} from "@/presentation/catalog-table";
import type { AttributeOwnerKind } from "@/domain/attributes";
import { formatAttributeEnum } from "@/domain/attribute-enums";
import { useCatalogTableAttributes } from "./use-catalog-table-attributes";
import {
  CatalogTableColumnSettings,
  useCatalogColumns,
} from "./catalog-table-column-settings";
import type { EntityPreview } from "@/presentation/entity-preview";
import {
  EntityReference,
  EntityReferenceWidthSample,
} from "./entity-reference";
import { GroupedTable, type GroupedTableColumn } from "./ui/grouped-table";
import {
  loadCompleteList,
  type InfiniteListSource,
  type RemoteCursorListSource,
} from "./infinite-list";

export interface CatalogTableEntry {
  entity: EntityPreview;
  category: string;
  fields: Array<{
    key: string;
    label: string;
    value: ReactNode;
    renderValue?: (decimals?: number) => ReactNode;
    sortValue: CatalogSortValue;
    attributeKey?: string;
  }>;
}
interface CatalogTableProps<T> {
  kind: AttributeOwnerKind;
  columnItems?: readonly T[];
  source: InfiniteListSource<T>;
  getKey: (item: T) => string | number;
  project: (item: T) => CatalogTableEntry;
  label: string;
  paused?: boolean;
}

export function EntityCatalogTable<T>(props: CatalogTableProps<T>) {
  const attributes = useCatalogTableAttributes(props.kind);
  return <ResolvedCatalogTable {...props} attributes={attributes} />;
}

/** Sorting requires the complete filtered result, including when IndexedDB is unavailable. */
function ResolvedCatalogTable<T>({
  kind,
  columnItems,
  attributes,
  source,
  getKey,
  project,
  label,
  paused,
}: CatalogTableProps<T> & {
  attributes: ReturnType<typeof useCatalogTableAttributes>;
}) {
  const t = useTranslations();
  const remote = source.kind === "remote" ? source : undefined;
  const endpoint = remote?.endpoint ?? "";
  const initialSlice = remote?.initialSlice;
  const [result, setResult] = useState<{
    initial: RemoteCursorListSource<T>["initialSlice"];
    items: T[];
  }>();
  const [errorSource, setErrorSource] = useState<typeof initialSlice>();
  const error = Boolean(initialSlice && errorSource === initialSlice);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (paused || !initialSlice) return;
    const controller = new AbortController();
    void loadCompleteList(
      { kind: "remote", endpoint, initialSlice },
      getKey,
      controller.signal,
    )
      .then((items) => {
        if (!controller.signal.aborted)
          setResult({ initial: initialSlice, items });
      })
      .catch(() => {
        if (!controller.signal.aborted) setErrorSource(initialSlice);
      });
    return () => controller.abort();
  }, [endpoint, initialSlice, getKey, paused, attempt]);
  const complete =
    source.kind === "local" ||
    Boolean(result && result.initial === initialSlice);
  return (
    <>
      {!complete && (
        <p
          role={error ? "alert" : "status"}
          className="mb-2 text-xs text-[var(--text-muted)]"
        >
          {error
            ? t("表格资料加载失败。")
            : t("正在准备完整表格，完成后可排序…")}
          {error && (
            <button
              className="ml-2 underline"
              onClick={() => {
                setErrorSource(undefined);
                setAttempt(attempt + 1);
              }}
            >
              {t("重试")}
            </button>
          )}
        </p>
      )}
      <CatalogRows
        kind={kind}
        columnItems={columnItems}
        attributes={attributes}
        items={
          source.kind === "local"
            ? source.items
            : complete
              ? result!.items
              : source.initialSlice.items
        }
        project={project}
        identity={
          source.kind === "local"
            ? (source.identity ?? "catalog")
            : `${endpoint}:${complete}`
        }
        label={label}
        ready={complete}
      />
    </>
  );
}

type TableRow = CatalogTableEntry & {
  fieldsByKey: Map<string, CatalogTableEntry["fields"][number]>;
};
type TableGroup = { key: string; rows: TableRow[] };
function CatalogRows<T>({
  kind,
  columnItems,
  attributes,
  items,
  project,
  identity,
  label,
  ready = true,
}: {
  kind: AttributeOwnerKind;
  columnItems?: readonly T[];
  attributes: ReturnType<typeof useCatalogTableAttributes>;
  items: readonly T[];
  project: (item: T) => CatalogTableEntry;
  identity: string;
  label: string;
  ready?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const params = useSearchParams();
  const sortKey = params.get("sort") ?? (kind === "hero" ? "category" : "");
  const direction = params.get("order") === "desc" ? "desc" : "asc";
  const preferences = useCatalogColumns(kind);
  const basicEntries = useMemo(
    () =>
      items.map((item) => {
        const entry = project(item);
        return {
          ...entry,
          fieldsByKey: new Map(entry.fields.map((field) => [field.key, field])),
        };
      }),
    [items, project],
  );
  const baseFields = useMemo(() => {
    const all = new Map<string, string>();
    const fixed: Record<string, string> =
      kind === "hero"
        ? {
            attack: "攻击类型",
            roles: "角色",
            base_strength: "力量",
            base_agility: "敏捷",
            base_intelligence: "智力",
            movement_speed: "移动速度",
            complexity: "操作难度",
          }
        : kind === "ability"
          ? {
              owners: "所属英雄",
              description: "效果说明",
              behavior: "施法方式",
              AbilityCooldown: "冷却时间",
              AbilityManaCost: "魔法消耗",
              upgrades: "升级",
            }
          : {};
    for (const [key, name] of Object.entries(fixed)) all.set(key, t(name));
    const attributeKeys = new Set<string>();
    for (const entry of columnItems ? columnItems.map(project) : basicEntries)
      for (const field of entry.fields) {
        if (!all.has(field.key)) all.set(field.key, field.label);
        if (field.attributeKey) attributeKeys.add(field.attributeKey);
      }
    return {
      fields: [...all].map(([key, name]) => ({ key, name })),
      attributeKeys,
    };
  }, [kind, columnItems, project, basicEntries, t]);
  const extraFields = useMemo(
    () =>
      (attributes.data?.columns ?? []).filter(
        (field) =>
          !baseFields.attributeKeys.has(field.key) &&
          !baseFields.fields.some((base) => base.key === field.field),
      ),
    [attributes.data, baseFields],
  );
  const defaultKeys = useMemo(
    () =>
      kind === "hero"
        ? HERO_DEFAULT_TABLE_COLUMNS
        : [
            "entity",
            "category",
            ...baseFields.fields.map((field) => field.key),
          ],
    [kind, baseFields],
  );
  const selected = preferences.selected ?? defaultKeys;
  const visible = useMemo(() => new Set(selected), [selected]);
  const extraNames = useMemo(
    () =>
      extraFields.map((field) => ({
        key: field.key,
        name: locale === "en" ? field.en : field.zh,
        detail: [locale === "en" ? field.ownerEn : field.ownerZh, field.field]
          .filter(Boolean)
          .join(" · "),
        search: `${field.zh} ${field.en} ${field.ownerZh ?? ""} ${field.ownerEn ?? ""} ${field.field}`,
      })),
    [extraFields, locale],
  );
  const fields = useMemo(
    () =>
      [...baseFields.fields, ...extraNames].filter((field) =>
        visible.has(field.key),
      ),
    [baseFields, extraNames, visible],
  );
  const selectedExtraFields = useMemo(
    () => extraFields.filter((field) => visible.has(field.key)),
    [extraFields, visible],
  );
  const entries = useMemo(
    () =>
      basicEntries.map((entry) => {
        const fieldsByKey = new Map(entry.fieldsByKey);
        for (const field of selectedExtraFields) {
          const values = attributes.data?.values[entry.entity.key]?.[field.key];
          if (!values?.length) continue;
          const name = locale === "en" ? field.en : field.zh;
          fieldsByKey.set(field.key, {
            key: field.key,
            label: name,
            value: values.join(" / "),
            renderValue: (decimals) => (
              <EntityReference
                entity={{
                  kind: "attribute",
                  key: field.attributeId,
                  name,
                  href: `/attributes/${encodeURIComponent(field.attributeId)}`,
                  attributeValue: values.join(" / "),
                  attributeField: field.field,
                }}
                inline
                icon={false}
              >
                {values
                  .map((value) =>
                    formatCatalogNumberText(
                      t(formatAttributeEnum(value, field.enumValues, locale)),
                      decimals,
                    ),
                  )
                  .join("\n")}
              </EntityReference>
            ),
            sortValue: catalogNumericValue(values.join(" / ")),
          });
        }
        return { ...entry, fieldsByKey };
      }),
    [basicEntries, selectedExtraFields, attributes.data, locale, t],
  );
  const resetSort = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("sort");
    url.searchParams.delete("order");
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  };
  const activeSort =
    ready &&
    visible.has(sortKey) &&
    (sortKey === "entity" ||
      sortKey === "category" ||
      fields.some((field) => field.key === sortKey))
      ? sortKey
      : "";
  const groups = useMemo(() => {
    const sorted = activeSort
      ? sortCatalogRows(
          entries,
          (entry) =>
            activeSort === "entity"
              ? entry.entity.name
              : activeSort === "category"
                ? entry.category
                : (entry.fieldsByKey.get(activeSort)?.sortValue ?? null),
          direction,
          locale,
        )
      : entries;
    // Several complete objects share a virtual block; every object occupies exactly one row.
    const blocks: TableGroup[] = [];
    for (let index = 0; index < sorted.length; index += 24)
      blocks.push({
        key: sorted[index].entity.key,
        rows: sorted.slice(index, index + 24),
      });
    return blocks;
  }, [entries, activeSort, direction, locale]);
  const columns = useMemo<GroupedTableColumn<TableGroup, TableRow>[]>(() => {
    const available = new Set([
      "entity",
      "category",
      ...fields.map((field) => field.key),
    ]);
    const ordered = selected.filter((key) => available.has(key));
    const headerSample = (name: string) => (
      <span className="inline-flex items-center gap-1">
        <span>{name}</span>
        <ArrowUpDown aria-hidden className="size-3 shrink-0" />
      </span>
    );
    const header = (key: string, name: string) => {
      const active = key === activeSort;
      const index = ordered.indexOf(key);
      const sort = (order: "asc" | "desc") => {
        const url = new URL(window.location.href);
        url.searchParams.set("sort", key);
        url.searchParams.set("order", order);
        window.history.replaceState(
          null,
          "",
          `${url.pathname}${url.search}${url.hash}`,
        );
      };
      return (
        <CatalogTableHeader
          columnKey={key}
          name={name}
          active={active}
          direction={direction}
          ready={ready}
          frozen={
            selected.indexOf(key) <=
            (preferences.frozenThrough === null
              ? -1
              : Math.max(
                  0,
                  selected.indexOf(preferences.frozenThrough ?? selected[0]),
                ))
          }
          onFreeze={() => preferences.setFrozenThrough(key)}
          onUnfreeze={() => preferences.setFrozenThrough(null)}
          numeric={entries.some((entry) => {
            const value = entry.fieldsByKey.get(key)?.sortValue;
            return typeof value === "number" || Array.isArray(value);
          })}
          decimals={preferences.decimals[key]}
          canMoveLeft={index > 0}
          canMoveRight={index < ordered.length - 1}
          onSort={sort}
          onHide={() => {
            preferences.save(selected.filter((value) => value !== key));
            if (key === sortKey) resetSort();
          }}
          onMove={(offset) => {
            const target = ordered[index + offset];
            if (!target) return;
            const next = selected.filter((value) => value !== key);
            next.splice(next.indexOf(target) + (offset > 0 ? 1 : 0), 0, key);
            preferences.save(next);
          }}
          onReorder={(target, after) => {
            const next = selected.filter((value) => value !== key);
            const position = next.indexOf(target);
            if (position < 0) return;
            next.splice(position + (after ? 1 : 0), 0, key);
            preferences.save(next);
          }}
          onDecimals={(digits) => preferences.setDecimals(key, digits)}
        />
      );
    };
    const allColumns: GroupedTableColumn<TableGroup, TableRow>[] = [
      {
        key: "entity",
        header: header("entity", t("对象")),
        headerWidthSample: headerSample(t("对象")),
        headerProps: {
          className: headerStyles.column,
          "data-catalog-column": "entity",
          "aria-sort":
            activeSort === "entity"
              ? direction === "asc"
                ? "ascending"
                : "descending"
              : "none",
        },
        width: 180,
        widthSample: entries.map((entry) => (
          <div key={entry.entity.key}>
            <EntityReferenceWidthSample entity={entry.entity} />
          </div>
        )),
        fitContent: true,
        maxContentWidth: 220,
        render: (entry) => <EntityReference entity={entry.entity} inline />,
      },
      {
        key: "category",
        header: header("category", t("分类")),
        headerWidthSample: headerSample(t("分类")),
        headerProps: {
          className: headerStyles.column,
          "data-catalog-column": "category",
          "aria-sort":
            activeSort === "category"
              ? direction === "asc"
                ? "ascending"
                : "descending"
              : "none",
        },
        width: 120,
        widthSample: [...new Set(entries.map((entry) => entry.category))].map(
          (value) => <div key={value}>{value}</div>,
        ),
        fitContent: true,
        render: (entry) => entry.category,
      },
      ...fields.map(({ key, name }) => ({
        key,
        header: header(key, name),
        headerWidthSample: headerSample(name),
        headerProps: {
          className: headerStyles.column,
          "data-catalog-column": key,
          "aria-sort":
            activeSort === key
              ? direction === "asc"
                ? ("ascending" as const)
                : ("descending" as const)
              : ("none" as const),
        },
        mergeKey: (entry: TableRow) =>
          entry.fieldsByKey.has(key)
            ? undefined
            : `missing:${entry.entity.key}`,
        widthSample: [
          ...new Set(
            entries.map((entry) => {
              const field = entry.fieldsByKey.get(key);
              if (!field) return "—";
              if (
                typeof field.value === "string" ||
                typeof field.value === "number"
              )
                return formatCatalogNumberText(
                  String(field.value),
                  preferences.decimals[key],
                );
              const value = field.sortValue;
              return formatCatalogNumberText(
                Array.isArray(value) ? value.join(" / ") : String(value ?? "—"),
                preferences.decimals[key],
              );
            }),
          ),
        ].map((value) => (
          <div key={value} className="tabular-nums">
            {value}
          </div>
        )),
        fitContent: true,
        maxContentWidth:
          key === "description"
            ? 360
            : key === "owners" || key === "roles"
              ? 480
              : 240,
        width:
          key === "description"
            ? 360
            : key === "roles" || key === "owners"
              ? 240
              : 120,
        render: (entry: TableRow) => {
          const field = entry.fieldsByKey.get(key);
          return (
            <span className="whitespace-pre-line tabular-nums">
              {field?.renderValue?.(preferences.decimals[key]) ??
                (typeof field?.value === "number" ||
                typeof field?.value === "string"
                  ? formatCatalogNumberText(
                      String(field.value),
                      preferences.decimals[key],
                    )
                  : (field?.value ?? "—"))}
            </span>
          );
        },
      })),
    ];
    const byKey = new Map(allColumns.map((column) => [column.key, column]));
    return selected.flatMap((key) => {
      const column = byKey.get(key);
      return column ? [column] : [];
    });
  }, [
    entries,
    fields,
    activeSort,
    direction,
    ready,
    t,
    selected,
    preferences,
    sortKey,
  ]);
  return (
    <div data-entity-catalog-table="">
      <CatalogTableColumnSettings
        kind={kind}
        options={[
          { key: "entity", name: t("对象") },
          { key: "category", name: t("分类") },
          ...baseFields.fields,
          ...extraNames,
        ]}
        selected={selected}
        loading={attributes.loading}
        failed={attributes.failed}
        retry={attributes.retry}
        saveFailed={preferences.saveFailed}
        onChange={(next) => {
          preferences.save(next);
          if (!next.includes(sortKey)) resetSort();
        }}
        onReset={() => {
          preferences.save(null);
          resetSort();
        }}
      />
      <GroupedTable
        groups={groups}
        columns={columns}
        identity={`${identity}:${activeSort}:${direction}:${selected.join("|")}:${attributes.data?.datasetVersionId ?? "attributes-loading"}`}
        label={label}
        rowKey={(entry) => entry.entity.key}
        rowProps={(entry) => ({ "data-catalog-entity": entry.entity.key })}
        fitWidth
        frozenCount={
          preferences.frozenThrough === null
            ? 0
            : Math.max(
                0,
                selected.indexOf(preferences.frozenThrough ?? selected[0]),
              ) + 1
        }
        empty={
          <p className="py-16 text-center text-sm text-[var(--text-muted)]">
            {t("没有符合条件的结果。")}
          </p>
        }
      />
    </div>
  );
}
