"use client";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "@/i18n/provider";
import valveAssetImageLoader from "./valve-asset-image-loader";
export function ItemIcon({
  itemKey,
  version,
  large = false,
}: {
  itemKey: string;
  version?: string | null;
  large?: boolean;
}) {
  const t = useTranslations();
  const [failed, setFailed] = useState<string | null>(null);
  const src = version ? `/valve-assets/item/${itemKey}?v=${version}` : "";
  return (
    <span
      className={`relative inline-grid shrink-0 place-items-center overflow-hidden bg-white/[0.035] ${large ? "h-16 w-[88px]" : "h-8 w-11"}`}
    >
      {src && failed !== src ? (
        <Image
          loader={valveAssetImageLoader}
          src={src}
          alt=""
          fill
          sizes={large ? "88px" : "44px"}
          loading={large ? "eager" : "lazy"}
          className="object-contain"
          onError={() => setFailed(src)}
        />
      ) : (
        <ImageOff
          className="size-4 text-[var(--text-muted)]"
          role="img"
          aria-label={t("图片待补充")}
        />
      )}
    </span>
  );
}
