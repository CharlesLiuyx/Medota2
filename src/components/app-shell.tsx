import Link from "next/link";
import { Database, GitBranch } from "lucide-react";
import type { ReactNode } from "react";
import { EntityTabs } from "./ui/entity-tabs";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-[var(--border-default)] bg-[var(--surface-overlay)] backdrop-blur-xl">
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
