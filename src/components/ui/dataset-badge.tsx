import { LocalizedText } from "@/i18n/provider";
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
        <LocalizedText>游戏版本</LocalizedText>{" "}
        <strong className="font-data font-medium text-[var(--accent-primary)]">
          {gameplayVersion ?? <LocalizedText>待确认</LocalizedText>}
        </strong>
      </span>
      <span>
        <LocalizedText>客户端</LocalizedText> {clientVersion}
      </span>
      {gateStatus !== "green" && (
        <span>
          <LocalizedText>
            {gateStatus === "yellow" ? "部分资料仍待核对" : "资料暂不可用"}
          </LocalizedText>
        </span>
      )}
    </div>
  );
}
