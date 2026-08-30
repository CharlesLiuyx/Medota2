"use client";

import Link from "next/link";
import { AbilityIcon } from "@/components/ability-icon";
import { InfiniteList } from "@/components/infinite-list";
import type { HeroDetail } from "@/server/repositories/heroes";

type HeroAbility = HeroDetail["abilities"][number];
type HeroFacet = HeroDetail["facets"][number];
type HeroRole = HeroDetail["roles"][number];
type HeroSourceFile = HeroDetail["sourceFiles"][number];
type HeroLocalization = HeroDetail["localizations"][number];
type ReferenceDiff = NonNullable<HeroDetail["comparison"]>["diffs"][number];

export type HeroStatRow = [label: string, value: unknown, suffix?: string];

export interface HeroTraceRow {
  label: string;
  value: string;
  mono?: boolean;
}

interface HeroListIdentity {
  listIdentity: string;
}

export function HeroAbilityList({
  abilities,
  assetVersion,
  lang,
  listIdentity,
}: HeroListIdentity & {
  abilities: HeroAbility[];
  assetVersion: string;
  lang: "en" | "zh-CN";
}) {
  return (
    <InfiniteList
      source={{
        kind: "local",
        items: abilities,
        identity: listIdentity,
      }}
      getKey={(ability) =>
        `${ability.internal_name}:${ability.relation_kind}:${ability.source_slot}:${ability.ordinal}`
      }
      ariaLabel="Hero abilities"
      className="mt-5 space-y-2"
      chunkClassName="grid gap-2 md:grid-cols-2"
      emptyFallback={
        <div className="mt-5 border border-dashed border-[var(--border-default)] p-6 text-sm text-[var(--text-muted)]">
          当前关系图没有此类 Ability。
        </div>
      }
      renderChunk={(items) =>
        items.map((ability) => {
          const name =
            (lang === "en" ? ability.en_name : ability.zh_name) ??
            ability.en_name ??
            ability.internal_name;
          return (
            <div
              key={`${ability.internal_name}-${ability.relation_kind}-${ability.source_slot}-${ability.ordinal}`}
              role="listitem"
              data-infinite-list-item=""
              data-infinite-list-key={`${ability.internal_name}:${ability.relation_kind}:${ability.source_slot}:${ability.ordinal}`}
            >
              <Link
                href={`/abilities/${ability.internal_name}${lang === "en" ? "?lang=en" : ""}`}
                className="flex h-full gap-3 border border-[var(--border-default)] bg-[var(--surface-panel)] p-3 hover:bg-[var(--surface-hover)]"
              >
                <AbilityIcon
                  internalName={ability.internal_name}
                  assetVersion={assetVersion}
                  name={name}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
                    {name}
                  </span>
                  <code className="mt-1 block truncate text-[9px] text-[var(--text-muted)]">
                    {ability.internal_name}
                  </code>
                  <span className="mt-2 flex flex-wrap gap-1">
                    <DetailBadge>{ability.relation_kind}</DetailBadge>
                    <DetailBadge muted={!ability.is_current}>
                      {ability.is_current ? "current" : ability.catalog_status}
                    </DetailBadge>
                    {ability.is_innate && <DetailBadge>innate</DetailBadge>}
                    {ability.is_ultimate && <DetailBadge>ultimate</DetailBadge>}
                    {ability.has_scepter_upgrade && (
                      <DetailBadge>scepter</DetailBadge>
                    )}
                    {ability.has_shard_upgrade && (
                      <DetailBadge>shard</DetailBadge>
                    )}
                  </span>
                </span>
              </Link>
            </div>
          );
        })
      }
    />
  );
}

export function HeroFacetList({
  facets,
  listIdentity,
}: HeroListIdentity & { facets: HeroFacet[] }) {
  return (
    <InfiniteList
      source={{ kind: "local", items: facets, identity: listIdentity }}
      getKey={(facet) => facet.facet_key}
      ariaLabel="Hero facets"
      className="mt-5 space-y-2"
      chunkClassName="grid gap-2 sm:grid-cols-2"
      renderChunk={(items) =>
        items.map((facet) => (
          <div
            key={facet.facet_key}
            role="listitem"
            data-infinite-list-item=""
            data-infinite-list-key={facet.facet_key}
            className="border border-[var(--border-default)] bg-[var(--surface-panel)] p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <code className="text-xs text-[var(--text-primary)]">
                {facet.facet_key}
              </code>
              <DetailBadge muted={facet.deprecated}>
                {facet.deprecated ? "Deprecated" : "Current"}
              </DetailBadge>
            </div>
            <p className="mt-2 text-[10px] text-[var(--text-muted)]">
              {facet.icon ?? "no icon"} · {facet.color ?? "no color"} · gradient{" "}
              {facet.gradient_id ?? "—"}
            </p>
          </div>
        ))
      }
    />
  );
}

export function HeroRoleList({
  roles,
  labels,
  listIdentity,
}: HeroListIdentity & {
  roles: HeroRole[];
  labels: Record<string, string>;
}) {
  return (
    <InfiniteList
      source={{ kind: "local", items: roles, identity: listIdentity }}
      getKey={(role) => role.role}
      ariaLabel="Hero role strengths"
      className="mt-4 space-y-3"
      chunkClassName="space-y-3"
      renderChunk={(items) =>
        items.map((role) => (
          <div
            key={role.role}
            role="listitem"
            data-infinite-list-item=""
            data-infinite-list-key={role.role}
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
        ))
      }
    />
  );
}

export function HeroStatGroup({
  title,
  rows,
  listIdentity,
}: HeroListIdentity & {
  title: string;
  rows: HeroStatRow[];
}) {
  return (
    <div className="border border-white/8 bg-[#121418] p-5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </p>
      <InfiniteList
        source={{ kind: "local", items: rows, identity: listIdentity }}
        getKey={(row) => row[0]}
        ariaLabel={`${title} stats`}
        contentRole="group"
        className="mt-4 space-y-0"
        renderChunk={(items) => (
          <dl className="grid grid-cols-2 gap-x-5">
            {items.map(([label, value, suffix]) => (
              <div
                key={label}
                data-infinite-list-item=""
                data-infinite-list-key={label}
                className="flex items-baseline justify-between gap-2 border-b border-white/6 py-2.5"
              >
                <dt className="text-[11px] text-zinc-600">{label}</dt>
                <dd className="font-mono text-xs tabular-nums text-zinc-200">
                  {formatValue(value)}
                  {suffix && !suffix.startsWith("+") ? (
                    suffix
                  ) : (
                    <span className="ml-1 text-[9px] text-zinc-600">
                      {suffix}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}
      />
    </div>
  );
}

export function HeroTraceList({
  rows,
  listIdentity,
}: HeroListIdentity & { rows: HeroTraceRow[] }) {
  return (
    <InfiniteList
      source={{ kind: "local", items: rows, identity: listIdentity }}
      getKey={(row) => row.label}
      ariaLabel="Hero provenance fields"
      contentRole="group"
      className="mt-5 space-y-3 text-[11px]"
      renderChunk={(items) => (
        <dl className="space-y-3">
          {items.map((row) => (
            <div
              key={row.label}
              data-infinite-list-item=""
              data-infinite-list-key={row.label}
            >
              <dt className="text-zinc-600">{row.label}</dt>
              <dd
                className={`mt-0.5 break-all text-zinc-300 ${row.mono ? "font-mono text-[9px]" : ""}`}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    />
  );
}

export function HeroSourceFileList({
  files,
  listIdentity,
}: HeroListIdentity & { files: HeroSourceFile[] }) {
  return (
    <InfiniteList
      source={{ kind: "local", items: files, identity: listIdentity }}
      getKey={(file) => file.source_path}
      ariaLabel="Hero source files"
      className="mt-4 space-y-4"
      chunkClassName="space-y-4"
      renderChunk={(items) =>
        items.map((file) => (
          <div
            key={file.source_path}
            role="listitem"
            data-infinite-list-item=""
            data-infinite-list-key={file.source_path}
          >
            <p className="break-all text-[10px] text-zinc-400">
              {file.source_path}
            </p>
            <code className="mt-1 block break-all text-[9px] text-zinc-700">
              {file.raw_sha256} · {file.encoding} · {file.size_bytes} B
            </code>
          </div>
        ))
      }
    />
  );
}

export function HeroLocalizationList({
  localizations,
  inheritedFields,
  listIdentity,
}: HeroListIdentity & {
  localizations: HeroLocalization[];
  inheritedFields: string[];
}) {
  const inheritedItems = inheritedFields.map((value, index) => ({
    key: `${index}:${value}`,
    value,
    suffix: index + 1 < inheritedFields.length ? ", " : "",
  }));
  return (
    <div className="mt-4 space-y-4 text-[9px] text-zinc-600">
      <InfiniteList
        source={{
          kind: "local",
          items: localizations,
          identity: `${listIdentity}:localizations`,
        }}
        getKey={(locale) => locale.locale}
        ariaLabel="Hero localization provenance"
        className="space-y-4"
        chunkClassName="space-y-4"
        renderChunk={(items) =>
          items.map((locale) => (
            <div
              key={locale.locale}
              role="listitem"
              data-infinite-list-item=""
              data-infinite-list-key={locale.locale}
            >
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
          ))
        }
      />
      <div>
        <p className="font-semibold text-zinc-500">Inherited</p>
        <div className="mt-1 break-all font-mono">
          <InfiniteList
            source={{
              kind: "local",
              items: inheritedItems,
              identity: `${listIdentity}:inherited`,
            }}
            getKey={(field) => field.key}
            ariaLabel="Inherited hero fields"
            emptyFallback="none"
            className="inline"
            chunkClassName="inline"
            renderChunk={(items) =>
              items.map((field) => (
                <span
                  key={field.key}
                  role="listitem"
                  data-infinite-list-item=""
                  data-infinite-list-key={field.key}
                >
                  {field.value}
                  {field.suffix}
                </span>
              ))
            }
          />
        </div>
      </div>
    </div>
  );
}

export function HeroReferenceDiffList({
  diffs,
  listIdentity,
}: HeroListIdentity & { diffs: ReferenceDiff[] }) {
  return (
    <InfiniteList
      source={{ kind: "local", items: diffs, identity: listIdentity }}
      getKey={(diff) => `${diff.field_name}:${diff.diff_type}`}
      ariaLabel="Hero reference differences"
      className="divide-y divide-white/7"
      chunkClassName="divide-y divide-white/7"
      emptyFallback={
        <p className="p-6 text-sm text-emerald-300/70">
          该英雄在首期比较字段中没有差异。
        </p>
      }
      renderChunk={(items) =>
        items.map((diff) => (
          <div
            key={`${diff.field_name}-${diff.diff_type}`}
            role="listitem"
            data-infinite-list-item=""
            data-infinite-list-key={`${diff.field_name}:${diff.diff_type}`}
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
        ))
      }
    />
  );
}

function DetailBadge({
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

function DiffValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-zinc-700">
        {label}
      </p>
      <code className="mt-1 block break-all text-[10px] text-zinc-400">
        {JSON.stringify(value) ?? "undefined"}
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
