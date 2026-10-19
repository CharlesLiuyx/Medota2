"use client";
import { useState, useSyncExternalStore } from "react";
import {
  viewportAssetLimit,
  type ViewportCatalog,
} from "@/domain/viewport-assets";

const subscribe = () => () => {};
const hydrated = () => true;
const server = () => false;

/** Fill the first viewport on navigation; keep chunk boundaries stable while scrolling. */
export function useCatalogViewport(entity: ViewportCatalog) {
  const ready = useSyncExternalStore(subscribe, hydrated, server);
  const [count, setCount] = useState<number | null>(null);
  if (ready && count === null) {
    setCount(
      Math.max(
        48,
        viewportAssetLimit(entity, window.innerWidth, window.innerHeight),
      ),
    );
  }
  return count ?? 48;
}
