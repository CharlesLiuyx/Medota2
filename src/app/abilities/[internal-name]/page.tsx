import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Database,
  GitCommitHorizontal,
  Link2,
  Sigma,
  Sparkles,
} from "lucide-react";
import { AbilityIcon } from "@/components/ability-icon";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { getAbilityByInternalName } from "@/server/repositories/abilities";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ "internal-name": string }>;
}): Promise<Metadata> {
  return { title: `${(await params)["internal-name"]} · Ability` };
}

export default async function AbilityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ "internal-name": string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const internalName = (await params)["internal-name"];
  if (!/^[a-z0-9_]+$/u.test(internalName)) notFound();
  const lang = (await searchParams).lang === "en" ? "en" : "zh-CN";
  const detail = await getAbilityByInternalName(internalName, lang);
  if (!detail) notFound();
  const preferred = detail.localizations.find((item) => item.locale === lang);
  const english = detail.localizations.find((item) => item.locale === "en");
  const name = preferred?.display_name ?? english?.display_name ?? internalName;
  const description = preferred?.description ?? english?.description;
  const ability = detail.ability;
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-9 sm:px-7 lg:px-10 lg:py-12">
      <Link
        href={`/abilities${lang === "en" ? "?lang=en" : ""}`}
        className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="size-3.5" /> 返回 Abilities
      </Link>
      <header className="mt-7 grid gap-6 border-b border-[var(--border-default)] pb-9 md:grid-cols-[auto_1fr_auto] md:items-end">
        <AbilityIcon internalName={internalName} name={name} large />
        <div>
          <p className="font-data text-[10px] uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {internalName}
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
            {name}
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-[var(--text-secondary)]">
            {description ?? "No localized description in this snapshot."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone="success">{String(ability.catalog_status)}</Badge>
            <Badge>{String(ability.definition_kind)}</Badge>
            {Boolean(ability.is_innate) && <Badge tone="accent">Innate</Badge>}
            {Boolean(ability.is_ultimate) && (
              <Badge tone="danger">Ultimate</Badge>
            )}
            {Boolean(ability.is_passive) && <Badge>Passive</Badge>}
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          <Link
            href={`/abilities/${internalName}`}
            aria-current={lang === "zh-CN" ? "page" : undefined}
            className="border border-[var(--border-default)] px-3 py-2 hover:border-[var(--border-strong)]"
          >
            简中
          </Link>
          <Link
            href={`/abilities/${internalName}?lang=en`}
            aria-current={lang === "en" ? "page" : undefined}
            className="border border-[var(--border-default)] px-3 py-2 hover:border-[var(--border-strong)]"
          >
            EN
          </Link>
        </div>
      </header>
      <nav
        aria-label="Ability sections"
        className="sticky top-16 z-20 mt-0 flex overflow-x-auto border-b border-[var(--border-default)] bg-[var(--surface-overlay)] text-xs backdrop-blur"
      >
        {[
          ["overview", "Overview"],
          ["values", "Values"],
          ["relations", "Heroes & relations"],
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
      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-10">
          <section id="overview">
            <SectionTitle icon={<Sparkles />} title="Definition" />
            <Panel className="mt-4 grid gap-px bg-[var(--border-subtle)] sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Behavior", formatArray(ability.behavior)],
                ["Damage", ability.damage_type],
                ["Target team", formatArray(ability.unit_target_team)],
                ["Cast range", ability.cast_range],
                ["Cast point", ability.cast_point],
                ["Channel", ability.channel_time],
                ["Cooldown", ability.cooldown],
                ["Mana", ability.mana_cost],
                ["BaseClass", ability.base_class],
              ].map(([label, value]) => (
                <KeyValue
                  key={String(label)}
                  label={String(label)}
                  value={value}
                />
              ))}
            </Panel>
          </section>
          <section id="values">
            <SectionTitle icon={<Sigma />} title="AbilityValues" />
            <div className="mt-4 max-w-full overflow-x-auto border border-[var(--border-default)]">
              <table className="w-full min-w-[640px] border-collapse text-left text-xs">
                <thead className="bg-[var(--surface-elevated)] text-[var(--text-muted)]">
                  <tr>
                    <th className="p-3">Key</th>
                    <th className="p-3">Levels</th>
                    <th className="p-3">Modifiers</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.values.map((value) => (
                    <tr
                      key={`${value.ordinal}-${value.value_key}`}
                      className="border-t border-[var(--border-subtle)]"
                    >
                      <th className="p-3 font-data font-normal text-[var(--text-primary)]">
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
                  ))}
                </tbody>
              </table>
              {!detail.values.length && (
                <p className="p-6 text-sm text-[var(--text-muted)]">
                  No AbilityValues nodes.
                </p>
              )}
            </div>
          </section>
          <section id="relations">
            <SectionTitle icon={<Link2 />} title="Heroes & relations" />
            <div className="mt-4 grid gap-2">
              {detail.bindings.map((binding) => (
                <Link
                  key={`${binding.hero_id}-${binding.relation_kind}-${binding.source_slot}`}
                  href={`/heroes/${binding.slug}`}
                  className="grid gap-2 border border-[var(--border-default)] bg-[var(--surface-panel)] p-4 hover:bg-[var(--surface-hover)] sm:grid-cols-[1fr_auto_auto]"
                >
                  <span>{binding.hero_name}</span>
                  <Badge>{binding.relation_kind}</Badge>
                  <code className="text-[10px] text-[var(--text-muted)]">
                    {binding.source_slot}
                  </code>
                </Link>
              ))}
              {!detail.bindings.length && (
                <Panel className="p-5 text-sm text-[var(--text-muted)]">
                  Defined but not reachable from a Hero relation.
                </Panel>
              )}
            </div>
          </section>
          <section id="raw">
            <SectionTitle icon={<Database />} title="Ordered raw source" />
            <div className="mt-4 space-y-3">
              {detail.sources.map((source) => (
                <details
                  key={source.occurrence_ordinal}
                  className="border border-[var(--border-default)] bg-[var(--surface-panel)]"
                >
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
              ))}
            </div>
          </section>
        </div>
        <aside id="provenance" className="space-y-4">
          <SectionTitle icon={<GitCommitHorizontal />} title="Provenance" />
          <Panel className="p-5 text-xs">
            <dl className="space-y-4">
              <Meta label="Dataset" value={detail.meta.datasetVersionId} />
              <Meta label="Commit" value={detail.meta.sourceCommit} />
              <Meta
                label="Client / revision"
                value={`${detail.meta.clientVersion} / ${detail.meta.sourceRevision}`}
              />
              <Meta
                label="Status"
                value={`${detail.meta.gateStatus} · ${detail.meta.reviewStatus}`}
              />
              <Meta label="Raw SHA-256" value={String(ability.raw_sha256)} />
              <Meta
                label="Resolved SHA-256"
                value={String(ability.resolved_sha256)}
              />
              <Meta
                label="Numeric IDs"
                value={
                  detail.idMappings.map((item) => item.ability_id).join(", ") ||
                  "none"
                }
              />
            </dl>
          </Panel>
          {Array.isArray(ability.unknown_fields) &&
            ability.unknown_fields.length > 0 && (
              <Panel className="p-5">
                <p className="text-[10px] uppercase tracking-wider text-[var(--status-warning)]">
                  Unknown source fields
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {ability.unknown_fields.map((field) => (
                    <Badge key={field} tone="warning">
                      {field}
                    </Badge>
                  ))}
                </div>
              </Panel>
            )}
        </aside>
      </div>
    </main>
  );
}

function SectionTitle({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--border-default)] pb-3 text-lg font-semibold [&_svg]:size-4 [&_svg]:text-[var(--accent-hover)]">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}
function KeyValue({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="bg-[var(--surface-panel)] p-4">
      <dt className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 break-words font-data text-xs text-[var(--text-primary)]">
        {value === null || value === undefined || value === ""
          ? "—"
          : String(value)}
      </dd>
    </div>
  );
}
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </dt>
      <dd className="mt-1 break-all font-data text-[10px] text-[var(--text-secondary)]">
        {value}
      </dd>
    </div>
  );
}
function formatArray(value: unknown): string {
  return Array.isArray(value) ? value.join(" · ") : value ? String(value) : "—";
}
