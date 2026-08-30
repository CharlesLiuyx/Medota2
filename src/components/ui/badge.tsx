import type { ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "danger"
  | "strength"
  | "agility"
  | "intelligence"
  | "universal";

const tones: Record<BadgeTone, string> = {
  neutral: "border-[var(--border-default)] text-[var(--text-secondary)]",
  accent:
    "border-[color-mix(in_srgb,var(--accent-primary)_45%,transparent)] bg-[var(--accent-soft)] text-[var(--accent-hover)]",
  success:
    "border-[color-mix(in_srgb,var(--status-success)_38%,transparent)] text-[var(--status-success)]",
  warning:
    "border-[color-mix(in_srgb,var(--status-warning)_38%,transparent)] text-[var(--status-warning)]",
  danger:
    "border-[color-mix(in_srgb,var(--status-danger)_38%,transparent)] text-[var(--status-danger)]",
  strength:
    "border-[color-mix(in_srgb,var(--attribute-strength)_42%,transparent)] text-[var(--attribute-strength)]",
  agility:
    "border-[color-mix(in_srgb,var(--attribute-agility)_42%,transparent)] text-[var(--attribute-agility)]",
  intelligence:
    "border-[color-mix(in_srgb,var(--attribute-intelligence)_42%,transparent)] text-[var(--attribute-intelligence)]",
  universal:
    "border-[color-mix(in_srgb,var(--attribute-universal)_42%,transparent)] text-[var(--attribute-universal)]",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
