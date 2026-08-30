import { AlertTriangle, CheckCircle2, Database } from "lucide-react";

export function DatasetBadge({
  clientVersion,
  sourceCommit,
  warningCount,
}: {
  clientVersion: string;
  sourceCommit: string;
  warningCount: number;
}) {
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
          {warningCount ? (
            <AlertTriangle
              className="size-3.5 text-[var(--status-warning)]"
              aria-label={`${warningCount} warnings`}
            />
          ) : (
            <CheckCircle2
              className="size-3.5 text-[var(--status-success)]"
              aria-label="Dataset healthy"
            />
          )}
        </span>
        <span className="mt-1 block font-data text-[10px] text-[var(--text-muted)]">
          {sourceCommit.slice(0, 10)} · {warningCount} warnings
        </span>
      </span>
    </div>
  );
}
