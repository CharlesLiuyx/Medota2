"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info } from "lucide-react";
import { HoverTooltip } from "@/components/ui/hover-tooltip";

const subscribe = () => () => {};
const getHost = () => document.getElementById("map-header-status");
const getServerHost = () => null;

/** The page owns version provenance; the shell provides its status location. */
export function MapHeaderStatus({
  patch,
  verified,
}: {
  patch: string;
  verified: boolean;
}) {
  const host = useSyncExternalStore(subscribe, getHost, getServerHost);
  if (!host) return null;
  const label = verified ? "地图哈希已核验" : "来源标注 · 客户端待确认";
  const Icon = verified ? CheckCircle2 : Info;
  return createPortal(
    <HoverTooltip
      className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]"
      content={
        <p className="text-xs">
          地图 {patch} · {label}
        </p>
      }
    >
      <Icon aria-hidden="true" size={12} />
      <span className="sr-only">地图校验状态：{label}</span>
      <span
        role="status"
        data-map-version={patch}
        className="sr-only sm:not-sr-only"
      >
        {label}
      </span>
    </HoverTooltip>,
    host,
  );
}
