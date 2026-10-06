"use client";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { useState } from "react";
import valveAssetImageLoader from "./valve-asset-image-loader";
export interface UnitPortraitRef {
  version: string;
  resolution: "portrait" | "shared_portrait" | "related_icon" | "unavailable";
}
export function UnitPortrait({
  unitKey,
  name,
  portrait,
  large = false,
}: {
  unitKey: string;
  name: string;
  portrait?: UnitPortraitRef;
  large?: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = portrait
    ? `/valve-assets/unit/${unitKey}?v=${portrait.version}`
    : "";
  const available =
    portrait && portrait.resolution !== "unavailable" && failed !== src;
  const label = !available
    ? "头像待补充"
    : portrait.resolution === "related_icon"
      ? "关联技能图标"
      : portrait.resolution === "shared_portrait"
        ? "共用模型头像"
        : "头像";
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden bg-white/[0.035] text-[var(--text-muted)] ${large ? "size-14" : "size-9"}`}
      title={label}
    >
      {available ? (
        <Image
          loader={valveAssetImageLoader}
          src={src}
          alt={`${name} · ${label}`}
          fill
          sizes={large ? "56px" : "36px"}
          loading={large ? "eager" : "lazy"}
          className="object-cover"
          onError={() => setFailed(src)}
        />
      ) : (
        <ImageOff className="size-4" role="img" aria-label={label} />
      )}
      {available && portrait.resolution === "related_icon" && (
        <span className="absolute bottom-0 right-0 bg-black/70 px-0.5 text-[8px]">
          技能
        </span>
      )}
    </span>
  );
}
