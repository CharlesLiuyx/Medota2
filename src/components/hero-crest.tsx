"use client";
import { useTranslations } from "@/i18n/provider";

import { HERO_PORTRAIT_SIZES } from "@/domain/viewport-assets";
import Image from "next/image";
import {
  isViewportAssetReady,
  rememberViewportAsset,
} from "@/browser/viewport-assets";
import { useState } from "react";
import valveAssetImageLoader from "./valve-asset-image-loader";

export function HeroCrest({
  name,
  attribute,
  large = false,
  portrait = false,
  src,
}: {
  name: string;
  attribute: string;
  large?: boolean;
  portrait?: boolean;
  src?: string;
}) {
  const t = useTranslations();
  const sizes = portrait
    ? HERO_PORTRAIT_SIZES
    : large
      ? "(min-width: 640px) 56px, 48px"
      : "56px";
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(/[\s-]+/u)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const color =
    attribute === "strength"
      ? "var(--attribute-strength)"
      : attribute === "agility"
        ? "var(--attribute-agility)"
        : attribute === "intelligence"
          ? "var(--attribute-intelligence)"
          : "var(--attribute-universal)";

  return (
    <div
      className={`relative grid shrink-0 place-items-center overflow-hidden ${portrait ? "aspect-[16/9] w-full" : large ? "size-12 sm:size-14" : "size-14"}`}
      style={{
        color,
        background: `linear-gradient(145deg, color-mix(in srgb, ${color} 58%, var(--surface-panel)), var(--surface-sunken))`,
      }}
      role={!src || failed ? "img" : undefined}
      aria-label={!src || failed ? t("{name} 图标未提供", { name }) : undefined}
    >
      {src && !failed && (
        <Image
          loader={valveAssetImageLoader}
          src={src}
          alt={t("{name} 图标", { name })}
          fill
          sizes={sizes}
          loading={large || isViewportAssetReady(src, sizes) ? "eager" : "lazy"}
          decoding="sync"
          onLoad={(event) =>
            rememberViewportAsset({ src, sizes }, event.currentTarget)
          }
          className="z-10 object-cover"
          onError={() => setFailed(true)}
        />
      )}
      <span
        className={`${large ? "text-3xl" : "text-xl"} font-black tracking-[-0.08em] opacity-85`}
      >
        {initials}
      </span>
    </div>
  );
}
