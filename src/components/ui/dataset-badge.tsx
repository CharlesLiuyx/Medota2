import type { CatalogGateStatus } from "@/domain/catalog";
export function DatasetBadge({
  clientVersion,
  gateStatus,
  gameplayVersion,
}: {
  clientVersion: string;
  sourceCommit: string;
  gateStatus: CatalogGateStatus;
  gameplayVersion?: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
      <span className="text-[var(--text-secondary)]">
        收录版本{" "}
        <strong className="font-data font-medium text-[var(--accent-primary)]">
          {gameplayVersion ?? "待确认"}
        </strong>
      </span>
      <span>客户端 {clientVersion}</span>
      {gateStatus !== "green" && (
        <span>
          {gateStatus === "yellow" ? "部分资料仍待核对" : "资料暂不可用"}
        </span>
      )}
    </div>
  );
}
