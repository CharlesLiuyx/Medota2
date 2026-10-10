"use client";

import { useSyncExternalStore } from "react";
import { Grid2X2, Table2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "@/i18n/provider";

export function useCatalogView() {
  return useSearchParams().get("view") === "table" ? "table" : "grid";
}

const subscribeToHydration = () => () => {};
const hydrated = () => true;
const notHydrated = () => false;

export function CatalogViewSwitch() {
  const ready = useSyncExternalStore(
    subscribeToHydration,
    hydrated,
    notHydrated,
  );
  const view = useCatalogView();
  const t = useTranslations();
  return (
    <div
      role="group"
      aria-label={t("视图切换")}
      className="flex shrink-0 items-center gap-0.5"
    >
      {(["grid", "table"] as const).map((value) => {
        const Icon = value === "grid" ? Grid2X2 : Table2;
        const label = value === "grid" ? t("网格视图") : t("表格视图");
        return (
          <button
            key={value}
            type="button"
            disabled={!ready}
            aria-label={label}
            aria-pressed={view === value}
            title={label}
            className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-[11px] ${view === value ? "bg-white/[0.07] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-white/[0.035]"}`}
            onClick={() => {
              const url = new URL(window.location.href);
              if (value === "table") url.searchParams.set("view", value);
              else url.searchParams.delete("view");
              window.history.replaceState(
                null,
                "",
                `${url.pathname}${url.search}${url.hash}`,
              );
            }}
          >
            <Icon aria-hidden className="size-3.5" />
            {value === "grid" ? t("网格") : t("表格")}
          </button>
        );
      })}
    </div>
  );
}
