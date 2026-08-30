"use client";

import type { ImageLoaderProps } from "next/image";

export default function valveAssetImageLoader({
  src,
  width,
}: ImageLoaderProps): string {
  const separator = src.includes("?") ? "&" : "?";
  return `${src}${separator}width=${width}`;
}
