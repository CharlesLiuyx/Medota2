"use client";

import Link from "next/link";
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
  const items: DefinitionItem[] = [
    ["Behavior", ability.behavior],
    ["Damage", ability.damage_type],
    ["Target team", ability.unit_target_team],
    ["Cast range", ability.cast_range],
    ["Cast point", ability.cast_point],
    ["Channel", ability.channel_time],
    ["Cooldown", ability.cooldown],
    ["Mana", ability.mana_cost],
    ["BaseClass", ability.base_class],
  ].map(([label, value]) => ({ label: String(label), value }));

  return (
    <InfiniteList
      source={{ kind: "local", items, identity: listIdentity }}
      getKey={(item) => item.label}
      ariaLabel="Ability definition fields"
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
        aria-label="Ability values"
        data-infinite-list=""
      >
        <caption className="sr-only">
          Ability values
          <span role="status" aria-live="polite" aria-atomic="true">
            {liveMessage}
          </span>
        </caption>
        <thead className="bg-[var(--surface-elevated)] text-[var(--text-muted)]">
          <tr>
            <th className="p-3">Key</th>
            <th className="p-3">Levels</th>
            <th className="p-3">Modifiers</th>
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
          No AbilityValues nodes.
        </p>
      )}
    </div>
  );
}

export function AbilityBindingList({
  bindings,
  listIdentity,
}: AbilityListIdentity & { bindings: AbilityBinding[] }) {
  return (
    <InfiniteList
      source={{ kind: "local", items: bindings, identity: listIdentity }}
      getKey={(binding) =>
        `${binding.hero_id}:${binding.relation_kind}:${binding.source_slot}:${binding.ordinal}`
      }
      ariaLabel="Hero ability bindings"
      className="mt-4 space-y-2"
      chunkClassName="grid gap-2"
      emptyFallback={
        <div className="mt-4 border border-[var(--border-default)] bg-[var(--surface-panel)] p-5 text-sm text-[var(--text-muted)]">
          Defined but not reachable from a Hero relation.
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
  return (
    <InfiniteList
      source={{ kind: "local", items: sources, identity: listIdentity }}
      getKey={(source) => source.occurrence_ordinal}
      ariaLabel="Ordered raw ability sources"
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
                Occurrence {source.occurrence_ordinal + 1} ·{" "}
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
  return (
    <InfiniteList
      source={{ kind: "local", items: rows, identity: listIdentity }}
      getKey={(row) => row.label}
      ariaLabel="Ability provenance fields"
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
  return (
    <InfiniteList
      source={{ kind: "local", items: mappings, identity: listIdentity }}
      getKey={(mapping) =>
        `${mapping.ability_id}:${mapping.source_path}:${mapping.source_line}`
      }
      ariaLabel="Ability numeric IDs"
      className="inline"
      chunkClassName="inline"
      emptyFallback="none"
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
  return (
    <InfiniteList
      source={{ kind: "local", items: fields, identity: listIdentity }}
      getKey={(field) => field}
      ariaLabel="Unknown ability source fields"
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
  const items = values.map((value, index) => ({
    key: `${index}:${value}`,
    value,
  }));
  return (
    <InfiniteList
      source={{ kind: "local", items, identity: listIdentity }}
      getKey={(item) => item.key}
      ariaLabel={`${label} values`}
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
                Loading failed. {error}{" "}
                <button
                  type="button"
                  onClick={retry}
                  className="border border-[var(--border-default)] px-3 py-1.5 text-[var(--text-primary)]"
                >
                  Retry {direction === "before" ? "earlier" : "more"}
                </button>
              </>
            ) : direction === "before" ? (
              "Loading earlier values…"
            ) : (
              "Loading more values…"
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
