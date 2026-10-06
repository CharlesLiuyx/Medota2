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
  neutral: "text-[var(--text-secondary)]",
  accent: "bg-[var(--accent-soft)] text-[var(--accent-hover)]",
  success: "text-[var(--status-success)]",
  warning: "text-[var(--status-warning)]",
  danger: "text-[var(--status-danger)]",
  strength: "text-[var(--attribute-strength)]",
  agility: "text-[var(--attribute-agility)]",
  intelligence: "text-[var(--attribute-intelligence)]",
  universal: "text-[var(--attribute-universal)]",
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
      className={`inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
