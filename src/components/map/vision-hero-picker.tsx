"use client";
import Image from "next/image";
import { memo, useEffect, useRef, useState } from "react";
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
    [limit, setLimit] = useState(24),
    [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    input = useRef<HTMLInputElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const selected = heroes.find((h) => h.key === value);
  const name = (h: VisionPreset) => (locale === "en" ? h.enName : h.zhName);
  const filtered = (open ? heroes : []).filter((h) =>
    `${h.zhName} ${h.enName} ${h.key}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return (
    <div
      ref={root}
      className="relative"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
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
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={t("选择英雄")}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full items-center gap-1 rounded bg-white/5 px-1 py-1 text-left"
        onClick={() => setOpen(!open)}
      >
        <VisionSourceIcon preset={selected} />
        <span className="min-w-0 flex-1 truncate">
          {selected ? name(selected) : t("选择英雄")}
        </span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 rounded border border-white/20 bg-[#172129] p-1 shadow-xl">
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
                className="flex w-full items-center gap-1 rounded p-1 text-left hover:bg-white/10 focus:bg-white/10"
                onClick={() => {
                  onChange(h.key);
                  setOpen(false);
                  trigger.current?.focus();
                }}
              >
                <VisionSourceIcon preset={h} />
                <span>{name(h)}</span>
              </button>
            ))}
            {!filtered.length && <p className="p-2">{t("没有匹配的英雄")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
