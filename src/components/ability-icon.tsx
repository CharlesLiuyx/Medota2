"use client";

import Image from "next/image";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import valveAssetImageLoader from "./valve-asset-image-loader";

export function AbilityIcon({
  internalName,
  name,
  assetVersion,
  large = false,
  compact = false,
}: {
  internalName: string;
  name: string;
  assetVersion: string;
  large?: boolean;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const size = compact ? "size-9" : large ? "size-16 sm:size-20" : "size-14";
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden bg-[linear-gradient(145deg,var(--surface-elevated),var(--surface-sunken))] text-[var(--text-muted)] ${size}`}
      role={failed ? "img" : undefined}
      aria-label={failed ? `${name} icon unavailable` : undefined}
    >
      <Sparkles className={large ? "size-8" : "size-5"} aria-hidden="true" />
      {!failed && (
        <Image
          loader={valveAssetImageLoader}
          src={`/valve-assets/ability/${internalName}?v=${encodeURIComponent(assetVersion)}`}
          alt={`${name} icon`}
          fill
          sizes={
            compact ? "36px" : large ? "(min-width: 640px) 80px, 64px" : "56px"
          }
          loading={large ? "eager" : "lazy"}
          className="object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
