"use client";

import Image from "next/image";
import { useState } from "react";
import valveAssetImageLoader from "./valve-asset-image-loader";

export function HeroCrest({
  name,
  attribute,
  large = false,
  src,
}: {
  name: string;
  attribute: string;
  large?: boolean;
  src?: string;
}) {
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
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-[var(--border-default)] ${large ? "size-28 sm:size-36" : "size-14"}`}
      style={{
        color,
        background: `linear-gradient(145deg, color-mix(in srgb, ${color} 58%, var(--surface-panel)), var(--surface-sunken))`,
      }}
      role={!src || failed ? "img" : undefined}
      aria-label={!src || failed ? `${name} icon unavailable` : undefined}
    >
      {src && !failed && (
        <Image
          loader={valveAssetImageLoader}
          src={src}
          alt={`${name} icon`}
          fill
          sizes={large ? "(min-width: 640px) 144px, 112px" : "56px"}
          loading={large ? "eager" : "lazy"}
          className="z-10 object-cover"
          onError={() => setFailed(true)}
        />
      )}
      <span
        className={`${large ? "text-3xl" : "text-xl"} font-black tracking-[-0.08em] opacity-85`}
      >
        {initials}
      </span>
      <span className="absolute inset-x-2 bottom-2 h-px bg-current opacity-35" />
      <span className="absolute -right-5 -top-5 size-14 rotate-45 border border-current opacity-15" />
    </div>
  );
}
