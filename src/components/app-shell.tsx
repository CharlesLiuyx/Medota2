import Link from "next/link";
import { Database, GitBranch, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import {
  ENVIRONMENT_LABELS,
  type PublicEnvironmentIdentity,
  type RuntimeEnvironment,
} from "@/domain/environment";
import { EntityTabs } from "./ui/entity-tabs";

const ENVIRONMENT_NOTICES: Readonly<
  Record<RuntimeEnvironment, { heading: string; dataNotice: string }>
> = {
  development: {
    heading: "DEVELOPMENT ENVIRONMENT",
    dataNotice: "SANDBOX DATA",
  },
  test: {
    heading: "TEST ENVIRONMENT",
    dataNotice: "SYNTHETIC-FIXTURE CLASS — NOT LIVE-PRODUCTION CLASS",
  },
  "local-review": {
    heading: "LOCAL REVIEW ENVIRONMENT",
    dataNotice: "PRODUCTION-SNAPSHOT CLASS — NOT LIVE-PRODUCTION CLASS",
  },
  production: {
    heading: "PRODUCTION ENVIRONMENT",
    dataNotice: "LIVE PRODUCTION DATA",
  },
};

const ENVIRONMENT_STYLES: Readonly<Record<RuntimeEnvironment, string>> = {
  development:
    "border-sky-400/35 bg-sky-400/10 text-sky-100 [--environment-accent:#7dd3fc]",
  test: "border-amber-400/45 bg-amber-400/12 text-amber-50 [--environment-accent:#fbbf24]",
  "local-review":
    "border-violet-400/45 bg-violet-400/12 text-violet-50 [--environment-accent:#c4b5fd]",
  production:
    "border-red-400/60 bg-red-500/15 text-red-50 [--environment-accent:#f87171]",
};

export function AppShell({
  children,
  environment,
}: {
  children: ReactNode;
  environment: PublicEnvironmentIdentity;
}) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--border-default)] bg-[var(--surface-overlay)] backdrop-blur-xl">
        <EnvironmentStrip environment={environment} />
        <div className="mx-auto flex max-w-[var(--content-max)] flex-wrap items-stretch justify-between px-4 sm:px-7 lg:px-10">
          <div className="flex min-h-16 items-stretch gap-5 sm:gap-8">
            <Link
              href="/heroes"
              className="group flex items-center gap-3"
              aria-label="Medota2 Heroes"
            >
              <span className="grid size-9 place-items-center border border-[color-mix(in_srgb,var(--accent-primary)_50%,transparent)] bg-[var(--accent-soft)] text-[var(--accent-hover)] group-hover:bg-[color-mix(in_srgb,var(--accent-primary)_20%,transparent)]">
                <span className="text-sm font-black tracking-[-0.16em]">
                  M2
                </span>
              </span>
              <span className="hidden sm:block">
                <span className="block text-[14px] font-semibold tracking-[0.17em] text-[var(--text-primary)]">
                  MEDOTA2
                </span>
                <span className="block text-[8px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                  VPK catalog
                </span>
              </span>
            </Link>
            <EntityTabs />
          </div>
          <div className="flex min-h-16 items-center gap-2 text-xs text-[var(--text-muted)]">
            <Database className="size-3.5" aria-hidden="true" />
            <span className="hidden md:inline">PostgreSQL · VPK SSOT</span>
            <Link
              href="/design-system"
              className="ml-2 hidden border-l border-[var(--border-default)] pl-4 text-[10px] uppercase tracking-[0.12em] hover:text-[var(--text-primary)] lg:block"
            >
              System
            </Link>
            <a
              href="https://github.com/CharlesLiuyx/Medota2"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub"
              className="ml-2 border border-[var(--border-default)] p-2 text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
            >
              <GitBranch className="size-4" />
            </a>
          </div>
        </div>
      </header>
      {children}
      <footer className="mx-auto flex max-w-[var(--content-max)] flex-col gap-2 border-t border-[var(--border-default)] px-4 py-8 text-xs text-[var(--text-muted)] sm:flex-row sm:items-center sm:justify-between sm:px-7 lg:px-10">
        <p>非官方自用项目。规范玩法字段来自固定 dota_vpk_updates 快照。</p>
        <p>Valve、Dota 2 及相关商标归其权利人所有。</p>
      </footer>
    </>
  );
}

export function EnvironmentStrip({
  environment,
}: {
  environment: PublicEnvironmentIdentity;
}) {
  const notice = ENVIRONMENT_NOTICES[environment.environment];
  const environmentHeading = environment.verified
    ? notice.heading
    : "DECLARED " + notice.heading;
  const dataNotice = environment.verified
    ? notice.dataNotice
    : "DECLARED DATA CLASS · " +
      environment.dataClass.toUpperCase() +
      " · NOT VERIFIED";

  return (
    <aside
      role="status"
      aria-label="Runtime environment"
      data-environment-indicator="true"
      data-environment={environment.environment}
      data-data-class={environment.dataClass}
      data-verification={environment.verified ? "verified" : "unverified"}
      data-run={environment.runId ?? "none"}
      className={`border-b ${ENVIRONMENT_STYLES[environment.environment]}`}
    >
      <div className="mx-auto flex min-h-8 max-w-[var(--content-max)] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 font-data text-[9px] font-semibold uppercase tracking-[0.1em] sm:px-7 sm:text-[10px] lg:px-10">
        <span className="flex items-center gap-1.5 text-[var(--environment-accent)]">
          {environment.verified ? (
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <ShieldAlert className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          {environmentHeading}
        </span>
        <span aria-hidden="true" className="opacity-35">
          /
        </span>
        <span>{dataNotice}</span>
        <span aria-hidden="true" className="hidden opacity-35 sm:inline">
          /
        </span>
        <span className="basis-full text-[var(--environment-accent)] sm:basis-auto">
          {environment.verified ? (
            <>
              DATABASE VERIFIED · {environment.databaseName} ·{" "}
              <span data-environment-fingerprint="true">
                {environment.safeFingerprint}
              </span>
            </>
          ) : (
            "DATABASE IDENTITY NOT VERIFIED — DATA ACCESS BLOCKED"
          )}
        </span>
        <span
          className="ml-auto text-[var(--environment-accent)]"
          data-environment-run-value="true"
        >
          RUN · {environment.runId ?? "NONE"}
        </span>
      </div>
    </aside>
  );
}

export function getEnvironmentTitlePrefix(
  environment: RuntimeEnvironment,
): string {
  return environment === "development"
    ? ""
    : `[${ENVIRONMENT_LABELS[environment]}] `;
}
