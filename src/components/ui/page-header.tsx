import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  accent,
  description,
  aside,
}: {
  eyebrow: string;
  title: string;
  accent?: string;
  description: string;
  aside?: ReactNode;
}) {
  return (
    <header className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[var(--accent-hover)]">
          {eyebrow}
        </p>
        <h1 className="mt-3 max-w-4xl text-balance text-4xl font-semibold tracking-[-0.04em] text-[var(--text-primary)] sm:text-5xl">
          {title}
          {accent && (
            <span className="text-[var(--text-muted)]"> {accent}</span>
          )}
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
          {description}
        </p>
      </div>
      {aside}
    </header>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  count,
  tone,
}: {
  eyebrow: string;
  title: string;
  count?: number;
  tone?: "strength" | "agility" | "intelligence" | "universal";
}) {
  const color = tone ? `var(--attribute-${tone})` : "var(--accent-primary)";
  return (
    <div className="flex items-end justify-between gap-4 border-b border-[var(--border-default)] pb-3">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="h-8 w-1"
          style={{ backgroundColor: color }}
        />
        <div>
          <p className="text-[9px] uppercase tracking-[0.22em] text-[var(--text-muted)]">
            {eyebrow}
          </p>
          <h2 className="mt-0.5 text-xl font-semibold text-[var(--text-primary)]">
            {title}
          </h2>
        </div>
      </div>
      {count !== undefined && (
        <span className="font-data text-xs tabular-nums text-[var(--text-muted)]">
          {count}
        </span>
      )}
    </div>
  );
}
