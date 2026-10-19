"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { useLocale } from "@/i18n/provider";
import { withLocale } from "@/i18n/locale";
import { withRelease } from "@/domain/releases";
import { useRelease } from "./release-navigation";
import {
  VIEWPORT_CATALOGS,
  viewportAssetLimit,
  type ViewportAsset,
} from "@/domain/viewport-assets";
import { backgroundTurn, warmViewportAsset } from "@/browser/viewport-assets";
import {
  canPrefetch,
  resourceKey,
  loadBrowserResource,
  verifyResourceResponse,
} from "@/browser/resources";

export function TabPreload() {
  const release = useRelease();
  const locale = useLocale();
  const router = useRouter();
  useEffect(() => {
    if (!release) return;
    const controller = new AbortController();
    const { signal } = controller;
    let running = false;
    const href = (path: string) =>
      withLocale(withRelease(path, release), locale);
    async function run() {
      if (running || !canPrefetch() || signal.aborted) return;
      running = true;
      try {
        // Full route data includes loading-boundary pages and offscreen mobile tabs.
        // Next disables all route prefetching in development; image warming still runs.
        for (const path of [
          ...VIEWPORT_CATALOGS.map((entity) => `/${entity}`),
          "/attributes",
          "/map",
          "/changes",
        ]) {
          if (!(await backgroundTurn(signal))) return;
          router.prefetch(href(path), { kind: PrefetchKind.FULL });
        }
        for (const entity of VIEWPORT_CATALOGS) {
          if (!(await backgroundTurn(signal))) return;
          const limit = viewportAssetLimit(
            entity,
            window.innerWidth,
            window.innerHeight,
          );
          const url = new URL(
            href("/api/catalog/viewport"),
            window.location.origin,
          );
          // withLocale/withRelease deliberately leave API links alone.
          url.searchParams.set("release", release!);
          url.searchParams.set("lang", locale);
          url.searchParams.set("entity", entity);
          url.searchParams.set("limit", String(limit));
          try {
            const { assets } = await loadBrowserResource<{
              assets: ViewportAsset[];
            }>(
              resourceKey(["viewport-assets", url.search]),
              async () => {
                const response = await fetch(url, {
                  signal: AbortSignal.timeout(15000),
                });
                verifyResourceResponse(response);
                if (!response.ok)
                  throw new Error("Viewport prefetch unavailable");
                return response.json();
              },
              "background",
              300_000,
            );
            for (let offset = 0; offset < assets.length; offset += 4) {
              if (!(await backgroundTurn(signal))) return;
              await Promise.allSettled(
                assets.slice(offset, offset + 4).map(warmViewportAsset),
              );
            }
            if (!signal.aborted) {
              const mark = `medota2:viewport:${entity}:${release}:${locale}`;
              performance.clearMarks(mark);
              performance.mark(mark);
            }
          } catch {
            /* Speculative failures leave normal navigation available; resume can retry. */
          }
        }
      } finally {
        running = false;
      }
    }
    // Hydration has finished. Let the current page and its eager resources settle first.
    const start = () => {
      void run();
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    document.addEventListener("visibilitychange", start);
    window.addEventListener("online", start);
    window.addEventListener("resize", start);
    return () => {
      controller.abort();
      window.removeEventListener("load", start);
      document.removeEventListener("visibilitychange", start);
      window.removeEventListener("online", start);
      window.removeEventListener("resize", start);
    };
  }, [release, locale, router]);
  return null;
}
