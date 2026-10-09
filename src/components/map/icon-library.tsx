"use client";
import { useState } from "react";
import { useTranslations } from "@/i18n/provider";
import type { MapIconSet } from "@/domain/map/icons";

/** Keeps alternative artwork discoverable without inventing static map objects. */
export function MapIconLibrary({ assets }: { assets: MapIconSet }) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(48);
  const matches = assets.icons.filter((i) =>
    `${i.key} ${i.label}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <details
      className="mt-3 border-t border-white/10 pt-2 text-xs"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer text-[var(--text-secondary)]">
        {t("地图图标库")} · {assets.icons.length}
      </summary>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-[var(--text-muted)]">
            {t(
              "当前点位已使用对应图标；备用样式、英雄变体和界面素材可在此查看。智慧圣坛专用图暂缺。",
            )}
          </p>
          <input
            aria-label={t("搜索地图图标")}
            placeholder={t("搜索地图图标")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(48);
            }}
            className="w-full max-w-sm rounded border border-white/15 bg-white/5 px-2 py-1"
          />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-10">
            {matches.slice(0, limit).map((icon) => (
              <a
                key={icon.key}
                href={icon.url}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 flex-col items-center gap-1 rounded bg-white/5 p-2"
                title={icon.key}
              >
                {/* Original small images, including alpha and non-square dimensions. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={icon.url}
                  alt={icon.label}
                  width={icon.width}
                  height={icon.height}
                  loading="lazy"
                  className="size-9 object-contain"
                />
                <span className="w-full truncate text-center">
                  {icon.label}
                </span>
                <span className="text-[9px] text-[var(--text-muted)]">
                  {icon.width} × {icon.height} ·{" "}
                  {t(
                    {
                      map: "地图",
                      hero: "英雄",
                      material: "独立材质",
                      hud: "界面素材",
                      supplement: "彩色守卫",
                    }[icon.group],
                  )}
                </span>
              </a>
            ))}
          </div>
          <p>
            {Math.min(limit, matches.length)} / {matches.length}
          </p>
          {limit < matches.length && (
            <button
              type="button"
              className="rounded bg-white/10 px-3 py-1"
              onClick={() => setLimit((n) => n + 48)}
            >
              {t("显示更多")}
            </button>
          )}
        </div>
      )}
    </details>
  );
}
