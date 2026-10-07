"use client";
import { Message, useTranslations } from "@/i18n/provider";

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
  const t = useTranslations();
  const host = useSyncExternalStore(subscribe, getHost, getServerHost);
  if (!host) return null;
  const label = verified ? t("地图哈希已核验") : t("来源标注 · 客户端待确认");
  const Icon = verified ? CheckCircle2 : Info;
  return createPortal(
    <HoverTooltip
      className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]"
      content={
        <p className="text-xs">
          <Message
            id="地图 {value0} · {value1}"
            values={{
              value0: patch,
              value1: label,
            }}
          />
        </p>
      }
    >
      <Icon aria-hidden="true" size={12} />
      <span className="sr-only">
        <Message
          id="地图校验状态：{value0}"
          values={{
            value0: label,
          }}
        />
      </span>
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
