"use client";
import { useTranslations } from "@/i18n/provider";

import Link from "@/components/version-link";
import { InfiniteList, useInfiniteList } from "@/components/infinite-list";
import { Badge } from "@/components/ui/badge";
import type { AbilityDetail } from "@/server/repositories/abilities";

type AbilityValue = AbilityDetail["values"][number];
type AbilityBinding = AbilityDetail["bindings"][number];
type AbilitySource = AbilityDetail["sources"][number];
type AbilityIdMapping = AbilityDetail["idMappings"][number];

interface AbilityListIdentity {
  listIdentity: string;
}

interface DefinitionItem {
  label: string;
  value: unknown;
}

interface MetaItem {
  label: string;
  value: string;
}

export function AbilityDefinitionList({
  ability,
  listIdentity,
}: AbilityListIdentity & { ability: AbilityDetail["ability"] }) {
  const t = useTranslations();
  const items: DefinitionItem[] = [
    [t("施法行为"), ability.behavior],
    [t("伤害"), ability.damage_type],
    [t("目标阵营"), ability.unit_target_team],
    [t("施法距离"), ability.cast_range],
    [t("施法前摇"), ability.cast_point],
    [t("持续施法"), ability.channel_time],
    [t("冷却时间"), ability.cooldown],
    [t("魔法消耗"), ability.mana_cost],
    ["BaseClass", ability.base_class],
  ].map(([label, value]) => ({ label: String(label), value }));

  return (
    <InfiniteList
      source={{ kind: "local", items, identity: listIdentity }}
      getKey={(item) => item.label}
      ariaLabel={t("技能定义字段")}
      contentRole="group"
      className="mt-4 border border-[var(--border-default)] bg-[var(--border-subtle)]"
      renderChunk={(chunkItems) => (
        <dl className="grid gap-px sm:grid-cols-2 lg:grid-cols-3">
          {chunkItems.map((item) => (
            <div
              key={item.label}
              data-infinite-list-item=""
              data-infinite-list-key={item.label}
              className="bg-[var(--surface-panel)] p-4"
            >
              <dt className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                {item.label}
              </dt>
              <dd className="mt-1 break-words font-data text-xs text-[var(--text-primary)]">
                {Array.isArray(item.value) ? (
                  <AbilityDefinitionValueList
                    values={item.value.map(String)}
                    listIdentity={`${listIdentity}:${item.label}`}
                    label={item.label}
                  />
                ) : (
                  formatValue(item.value)
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    />
  );
}

export function AbilityValuesTable({
  values,
  listIdentity,
}: AbilityListIdentity & { values: AbilityValue[] }) {
  const t = useTranslations();
  const {
    chunks,
    isEmpty,
    isBusy,
    before,
    after,
    liveMessage,
    rootRef,
    topSentinelRef,
    bottomSentinelRef,
    chunkRef,
    retryBefore,
    retryAfter,
  } = useInfiniteList({
    source: { kind: "local", items: values, identity: listIdentity },
    getKey: (value) => `${value.ordinal}:${value.value_key}`,
  });

  return (
    <div className="mt-4 max-w-full overflow-x-auto border border-[var(--border-default)]">
      <table
        ref={rootRef}
        className="w-full min-w-[640px] border-collapse text-left text-xs"
        aria-busy={isBusy}
        aria-label={t("技能数值")}
        data-infinite-list=""
      >
        <caption className="sr-only">
          {t("技能数值")}
          <span role="status" aria-live="polite" aria-atomic="true">
            {liveMessage}
          </span>
        </caption>
        <thead className="bg-[var(--surface-elevated)] text-[var(--text-muted)]">
          <tr>
            <th className="p-3">{t("字段")}</th>
            <th className="p-3">{t("等级数值")}</th>
            <th className="p-3">{t("修正条件")}</th>
          </tr>
        </thead>
        {!isEmpty && (
          <>
            <TableBoundaryStatus
              direction="before"
              loading={before.loading}
              error={before.error}
              retry={retryBefore}
            />
            <tbody
              ref={topSentinelRef}
              data-infinite-boundary="before"
              data-infinite-list-sentinel="before"
              aria-hidden="true"
            >
              <tr>
                <td colSpan={3} className="h-px p-0" />
              </tr>
            </tbody>
            {chunks.map((chunk) => (
              <tbody
                key={chunk.id}
                ref={(node) => chunkRef(chunk.id, node)}
                data-infinite-list-chunk=""
                data-infinite-chunk-id={chunk.id}
              >
                {chunk.rendered ? (
                  chunk.items.map((value) => (
                    <tr
                      key={`${value.ordinal}-${value.value_key}`}
                      data-infinite-list-item=""
                      data-infinite-list-key={`${value.ordinal}:${value.value_key}`}
                      className="border-t border-[var(--border-subtle)]"
                    >
                      <th
                        scope="row"
                        className="p-3 font-data font-normal text-[var(--text-primary)]"
                      >
                        {value.value_key}
                      </th>
                      <td className="p-3 font-data">
                        {value.level_values.join(" · ") || "—"}
                      </td>
                      <td className="p-3">
                        <pre className="max-w-xl whitespace-pre-wrap text-[10px] text-[var(--text-muted)]">
                          {value.modifiers.length
                            ? JSON.stringify(value.modifiers, null, 2)
                            : "—"}
                        </pre>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr data-infinite-list-spacer="" aria-hidden="true">
                    <td
                      colSpan={3}
                      className="p-0"
                      style={{ height: chunk.measuredHeight ?? 0 }}
                    />
                  </tr>
                )}
              </tbody>
            ))}
            <tbody
              ref={bottomSentinelRef}
              data-infinite-boundary="after"
              data-infinite-list-sentinel="after"
              aria-hidden="true"
            >
              <tr>
                <td colSpan={3} className="h-px p-0" />
              </tr>
            </tbody>
            <TableBoundaryStatus
              direction="after"
              loading={after.loading}
              error={after.error}
              retry={retryAfter}
            />
          </>
        )}
      </table>
      {isEmpty && (
        <p className="p-6 text-sm text-[var(--text-muted)]">
          {t("没有技能数值节点。")}
        </p>
      )}
    </div>
  );
}

export function AbilityBindingList({
  bindings,
  listIdentity,
}: AbilityListIdentity & { bindings: AbilityBinding[] }) {
  const t = useTranslations();
  return (
    <InfiniteList
      source={{ kind: "local", items: bindings, identity: listIdentity }}
      getKey={(binding) =>
        `${binding.hero_id}:${binding.relation_kind}:${binding.source_slot}:${binding.ordinal}`
      }
      ariaLabel={t("英雄技能绑定")}
      className="mt-4 space-y-2"
      chunkClassName="grid gap-2"
      emptyFallback={
        <div className="mt-4 border border-[var(--border-default)] bg-[var(--surface-panel)] p-5 text-sm text-[var(--text-muted)]">
          {t("已定义，尚未关联到英雄。")}
        </div>
      }
      renderChunk={(items) =>
        items.map((binding) => {
          const key = `${binding.hero_id}:${binding.relation_kind}:${binding.source_slot}:${binding.ordinal}`;
          return (
            <div
              key={key}
              role="listitem"
              data-infinite-list-item=""
              data-infinite-list-key={key}
            >
              <Link
                href={`/heroes/${binding.slug}`}
                className="grid gap-2 border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 hover:bg-[var(--surface-hover)] sm:grid-cols-[1fr_auto_auto]"
              >
                <span>{binding.hero_name}</span>
                <Badge>{binding.relation_kind}</Badge>
                <code className="text-[10px] text-[var(--text-muted)]">
                  {binding.source_slot}
                </code>
              </Link>
            </div>
          );
        })
      }
    />
  );
}

export function AbilitySourceList({
  sources,
  listIdentity,
}: AbilityListIdentity & { sources: AbilitySource[] }) {
  const t = useTranslations();
  return (
    <InfiniteList
      source={{ kind: "local", items: sources, identity: listIdentity }}
      getKey={(source) => source.occurrence_ordinal}
      ariaLabel={t("有序技能原始来源")}
      className="mt-4 space-y-3"
      chunkClassName="space-y-3"
      renderChunk={(items) =>
        items.map((source) => (
          <div
            key={source.occurrence_ordinal}
            role="listitem"
            data-infinite-list-item=""
            data-infinite-list-key={source.occurrence_ordinal}
          >
            <details className="border border-[var(--border-default)] bg-[var(--surface-panel)]">
              <summary className="cursor-pointer px-4 py-3 font-data text-xs">
                {t("来源出现记录")} {source.occurrence_ordinal + 1} ·{" "}
                {source.source_path}:{source.source_line ?? "?"}
              </summary>
              <pre className="max-h-[34rem] overflow-auto border-t border-[var(--border-subtle)] p-4 text-[10px] leading-5 text-[var(--text-secondary)]">
                {JSON.stringify(source.raw_definition, null, 2).slice(
                  0,
                  100_000,
                )}
              </pre>
            </details>
          </div>
        ))
      }
    />
  );
}

export function AbilityMetaList({
  rows,
  listIdentity,
}: AbilityListIdentity & { rows: MetaItem[] }) {
  const t = useTranslations();
  return (
    <InfiniteList
      source={{ kind: "local", items: rows, identity: listIdentity }}
      getKey={(row) => row.label}
      ariaLabel={t("技能来源字段")}
      contentRole="group"
      className="space-y-4"
      renderChunk={(items) => (
        <dl className="space-y-4">
          {items.map((item) => (
            <div
              key={item.label}
              data-infinite-list-item=""
              data-infinite-list-key={item.label}
            >
              <dt className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                {item.label}
              </dt>
              <dd className="mt-1 break-all font-data text-[10px] text-[var(--text-secondary)]">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    />
  );
}

export function AbilityNumericIdList({
  mappings,
  listIdentity,
}: AbilityListIdentity & { mappings: AbilityIdMapping[] }) {
  const t = useTranslations();
  return (
    <InfiniteList
      source={{ kind: "local", items: mappings, identity: listIdentity }}
      getKey={(mapping) =>
        `${mapping.ability_id}:${mapping.source_path}:${mapping.source_line}`
      }
      ariaLabel={t("技能数字编号")}
      className="inline"
      chunkClassName="inline"
      emptyFallback={t("无")}
      renderChunk={(items, context) =>
        items.map((mapping, index) => {
          const key = `${mapping.ability_id}:${mapping.source_path}:${mapping.source_line}`;
          return (
            <span
              key={key}
              role="listitem"
              data-infinite-list-item=""
              data-infinite-list-key={key}
            >
              {index > 0 || context.previousItem ? ", " : ""}
              {mapping.ability_id}
            </span>
          );
        })
      }
    />
  );
}

export function AbilityUnknownFieldList({
  fields,
  listIdentity,
}: AbilityListIdentity & { fields: string[] }) {
  const t = useTranslations();
  return (
    <InfiniteList
      source={{ kind: "local", items: fields, identity: listIdentity }}
      getKey={(field) => field}
      ariaLabel={t("未知技能来源字段")}
      className="mt-3 space-y-1"
      chunkClassName="flex flex-wrap gap-1"
      renderChunk={(items) =>
        items.map((field) => (
          <span
            key={field}
            role="listitem"
            data-infinite-list-item=""
            data-infinite-list-key={field}
          >
            <Badge tone="warning">{field}</Badge>
          </span>
        ))
      }
    />
  );
}

function AbilityDefinitionValueList({
  values,
  listIdentity,
  label,
}: {
  values: string[];
  listIdentity: string;
  label: string;
}) {
  const t = useTranslations();
  const items = values.map((value, index) => ({
    key: `${index}:${value}`,
    value,
  }));
  return (
    <InfiniteList
      source={{ kind: "local", items, identity: listIdentity }}
      getKey={(item) => item.key}
      ariaLabel={t("{label} 数值", { label })}
      className="inline"
      chunkClassName="inline"
      emptyFallback="—"
      renderChunk={(chunk, context) =>
        chunk.map((item, index) => (
          <span
            key={item.key}
            role="listitem"
            data-infinite-list-item=""
            data-infinite-list-key={item.key}
          >
            {index > 0 || context.previousItem ? " · " : ""}
            {item.value}
          </span>
        ))
      }
    />
  );
}

function TableBoundaryStatus({
  direction,
  loading,
  error,
  retry,
}: {
  direction: "before" | "after";
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  const t = useTranslations();
  if (!loading && !error) return null;
  return (
    <tbody data-infinite-list-status={direction}>
      <tr>
        <td
          colSpan={3}
          className={`p-3 text-center text-xs ${error ? "text-[var(--status-danger)]" : "text-[var(--text-muted)]"}`}
        >
          <div role={error ? "alert" : "status"}>
            {error ? (
              <>
                {t("加载失败。")} {error}{" "}
                <button
                  type="button"
                  onClick={retry}
                  className="border border-[var(--border-default)] px-3 py-1.5 text-[var(--text-primary)]"
                >
                  {t(direction === "before" ? "重试较早结果" : "重试更多结果")}
                </button>
              </>
            ) : direction === "before" ? (
              t("正在加载更早的数值…")
            ) : (
              t("正在加载更多数值…")
            )}
          </div>
        </td>
      </tr>
    </tbody>
  );
}

function formatValue(value: unknown): string {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}
