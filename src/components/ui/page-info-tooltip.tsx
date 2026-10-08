import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { HoverTooltip } from "./hover-tooltip";

export function PageInfoTooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <HoverTooltip
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      content={
        <div className="text-xs leading-relaxed text-[var(--text-secondary)]">
          {children}
        </div>
      }
    >
      <Info className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </HoverTooltip>
  );
}
