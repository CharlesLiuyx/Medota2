import { AlertTriangle, CheckCircle2, CircleX, Database } from "lucide-react";
import type { CatalogGateStatus } from "@/domain/catalog";

const gatePresentation = {
  green: {
    Icon: CheckCircle2,
    color: "text-[var(--status-success)]",
    label: "Green",
  },
  yellow: {
    Icon: AlertTriangle,
    color: "text-[var(--status-warning)]",
    label: "Yellow",
  },
  red: {
    Icon: CircleX,
    color: "text-[var(--status-danger)]",
    label: "Red",
  },
} as const satisfies Record<
  CatalogGateStatus,
  { Icon: typeof CheckCircle2; color: string; label: string }
>;

export function DatasetBadge({
  clientVersion,
  sourceCommit,
  gateStatus,
}: {
  clientVersion: string;
  sourceCommit: string;
  gateStatus: CatalogGateStatus;
}) {
  const { Icon, color, label } = gatePresentation[gateStatus];

  return (
    <div className="grid min-w-64 grid-cols-[auto_1fr] border border-[var(--border-default)] bg-[var(--surface-panel)] text-xs">
      <span className="grid w-11 place-items-center border-r border-[var(--border-subtle)] text-[var(--accent-hover)]">
        <Database className="size-4" aria-hidden="true" />
      </span>
      <span className="px-3 py-2.5">
        <span className="flex items-center justify-between gap-4">
          <span className="font-data text-[var(--text-secondary)]">
            Client {clientVersion}
          </span>
          <Icon
            className={`size-3.5 ${color}`}
            aria-label={`Dataset gate ${label}`}
          />
        </span>
        <span className="mt-1 block font-data text-[10px] text-[var(--text-muted)]">
          {sourceCommit.slice(0, 10)} · {label.toUpperCase()}
        </span>
      </span>
    </div>
  );
}
