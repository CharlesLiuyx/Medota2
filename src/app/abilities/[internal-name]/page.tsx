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
import {
  AbilityBindingList,
  AbilityDefinitionList,
  AbilityMetaList,
  AbilityNumericIdList,
  AbilitySourceList,
  AbilityUnknownFieldList,
  AbilityValuesTable,
} from "@/components/ability-detail-lists";
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
  const listIdentity = `${detail.meta.datasetVersionId}:${internalName}:${lang}`;
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-9 sm:px-7 lg:px-10 lg:py-12">
      <Link
        href={`/abilities${lang === "en" ? "?lang=en" : ""}`}
        className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft className="size-3.5" /> 返回 Abilities
      </Link>
      <header className="mt-7 grid gap-6 border-b border-[var(--border-default)] pb-9 md:grid-cols-[auto_1fr_auto] md:items-end">
        <AbilityIcon
          internalName={internalName}
          name={name}
          assetVersion={detail.meta.assetDatasetVersionId}
          large
        />
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
            <AbilityDefinitionList
              ability={ability}
              listIdentity={`${listIdentity}:definition`}
            />
          </section>
          <section id="values">
            <SectionTitle icon={<Sigma />} title="AbilityValues" />
            <AbilityValuesTable
              values={detail.values}
              listIdentity={`${listIdentity}:values`}
            />
          </section>
          <section id="relations">
            <SectionTitle icon={<Link2 />} title="Heroes & relations" />
            <AbilityBindingList
              bindings={detail.bindings}
              listIdentity={`${listIdentity}:bindings`}
            />
          </section>
          <section id="raw">
            <SectionTitle icon={<Database />} title="Ordered raw source" />
            <AbilitySourceList
              sources={detail.sources}
              listIdentity={`${listIdentity}:sources`}
            />
          </section>
        </div>
        <aside id="provenance" className="space-y-4">
          <SectionTitle icon={<GitCommitHorizontal />} title="Provenance" />
          <Panel className="p-5 text-xs">
            <AbilityMetaList
              listIdentity={`${listIdentity}:provenance`}
              rows={[
                {
                  label: "Dataset",
                  value: detail.meta.datasetVersionId,
                },
                { label: "Commit", value: detail.meta.sourceCommit },
                {
                  label: "Client / revision",
                  value: `${detail.meta.clientVersion} / ${detail.meta.sourceRevision}`,
                },
                {
                  label: "Status",
                  value: `${detail.meta.gateStatus} · ${detail.meta.reviewStatus}`,
                },
                { label: "Raw SHA-256", value: String(ability.raw_sha256) },
                {
                  label: "Resolved SHA-256",
                  value: String(ability.resolved_sha256),
                },
              ]}
            />
            <div className="mt-4">
              <p className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                Numeric IDs
              </p>
              <div className="mt-1 break-all font-data text-[10px] text-[var(--text-secondary)]">
                <AbilityNumericIdList
                  mappings={detail.idMappings}
                  listIdentity={`${listIdentity}:numeric-ids`}
                />
              </div>
            </div>
          </Panel>
          {Array.isArray(ability.unknown_fields) &&
            ability.unknown_fields.length > 0 && (
              <Panel className="p-5">
                <p className="text-[10px] uppercase tracking-wider text-[var(--status-warning)]">
                  Unknown source fields
                </p>
                <AbilityUnknownFieldList
                  fields={ability.unknown_fields}
                  listIdentity={`${listIdentity}:unknown-fields`}
                />
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
