"use client";

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
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
  const [pending, startTransition] = useTransition();
  const [queued, setQueued] = useState(false);
  const [requested, setRequested] = useState(view);
  const frame = useRef(0);
  useEffect(() => {
    const cancel = () => {
      cancelAnimationFrame(frame.current);
      setQueued(false);
    };
    window.addEventListener("popstate", cancel);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("popstate", cancel);
    };
  }, []);
  const selected = pending || queued ? requested : view;
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
            aria-pressed={selected === value}
            aria-busy={(pending || queued) && requested === value}
            title={label}
            className={`inline-flex h-7 items-center gap-1.5 rounded px-2 text-[11px] ${selected === value ? "bg-white/[0.07] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:bg-white/[0.035]"}`}
            onClick={() => {
              const origin = new URL(window.location.href);
              setRequested(value);
              setQueued(true);
              cancelAnimationFrame(frame.current);
              // Give the requested view one paint before mounting a wide table.
              frame.current = requestAnimationFrame(() => {
                frame.current = requestAnimationFrame(() => {
                  setQueued(false);
                  const url = new URL(window.location.href);
                  if (
                    url.pathname !== origin.pathname ||
                    url.searchParams.get("release") !==
                      origin.searchParams.get("release")
                  )
                    return;
                  if (value === "table") url.searchParams.set("view", value);
                  else url.searchParams.delete("view");
                  startTransition(() => {
                    window.history.replaceState(
                      null,
                      "",
                      `${url.pathname}${url.search}${url.hash}`,
                    );
                  });
                });
              });
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
