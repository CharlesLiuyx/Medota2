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
}: {
  internalName: string;
  name: string;
  assetVersion: string;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const size = large ? "size-24 sm:size-28" : "size-14";
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-[var(--border-default)] bg-[linear-gradient(145deg,var(--surface-elevated),var(--surface-sunken))] text-[var(--text-muted)] ${size}`}
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
          sizes={large ? "(min-width: 640px) 112px, 96px" : "56px"}
          loading={large ? "eager" : "lazy"}
          className="object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
