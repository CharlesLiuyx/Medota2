"use client";
import Image from "next/image";
import { CompactFilterMenu } from "../ui/compact-filter-menu";
import { memo, useRef, useState } from "react";
import { useLocale, useTranslations } from "@/i18n/provider";
import type { VisionPreset } from "@/domain/map/vision-sources";
import loader from "@/components/valve-asset-image-loader";

export const VisionSourceIcon = memo(function VisionSourceIcon({
  preset,
  size = 24,
}: {
  preset?: VisionPreset;
  size?: number;
}) {
  const t = useTranslations();
  const [failed, setFailed] = useState<string | null>(null);
  return preset?.imageUrl && failed !== preset.imageUrl ? (
    <Image
      loader={loader}
      src={preset.imageUrl}
      alt=""
      width={size}
      height={size}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
      onError={() => setFailed(preset.imageUrl)}
    />
  ) : (
    <span
      role="img"
      aria-label={t("图片待补充")}
      className="inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      ◇
    </span>
  );
});

export function VisionHeroPicker({
  heroes,
  value,
  onChange,
}: {
  heroes: VisionPreset[];
  value: string;
  onChange(key: string): void;
}) {
  const t = useTranslations(),
    locale = useLocale();
  const [query, setQuery] = useState(""),
    [limit, setLimit] = useState(24);
  const root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null);
  const selected = heroes.find((h) => h.key === value);
  const name = (h: VisionPreset) => (locale === "en" ? h.enName : h.zhName);
  const filtered = heroes.filter((h) =>
    `${h.zhName} ${h.enName} ${h.key}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const options = [
            ...root.current!.querySelectorAll<HTMLButtonElement>(
              '[role="option"]',
            ),
          ];
          const at = options.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          options[
            (at + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
              options.length
          ]?.focus();
        }
      }}
    >
      <CompactFilterMenu
        title={t("选择英雄")}
        count={0}
        onOpen={() => input.current?.focus({ preventScroll: true })}
        trigger={
          <>
            <VisionSourceIcon preset={selected} />
            <span className="min-w-0 flex-1 truncate">
              {selected ? name(selected) : t("选择英雄")}
            </span>
          </>
        }
      >
        <div className="w-[min(260px,calc(100vw-32px))]">
          <input
            ref={input}
            aria-label={t("搜索英雄")}
            placeholder={t("搜索英雄")}
            className="mb-1 w-full rounded bg-white/10 px-2 py-1"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(24);
            }}
          />
          <div
            role="listbox"
            aria-label={t("英雄列表")}
            className="max-h-52 overflow-y-auto"
            onScroll={(e) => {
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 60)
                setLimit((n) => n + 24);
            }}
          >
            {filtered.slice(0, limit).map((h) => (
              <button
                type="button"
                key={h.key}
                role="option"
                aria-label={name(h)}
                aria-selected={h.key === value}
                className="compact-menu-option w-full text-left"
                onClick={() => {
                  onChange(h.key);
                  const menu = root.current?.querySelector("details");
                  if (menu) menu.open = false;
                  menu
                    ?.querySelector("summary")
                    ?.focus({ preventScroll: true });
                }}
              >
                <VisionSourceIcon preset={h} />
                <span>{name(h)}</span>
              </button>
            ))}
            {!filtered.length && <p className="p-2">{t("没有匹配的英雄")}</p>}
          </div>
        </div>
      </CompactFilterMenu>
    </div>
  );
}
