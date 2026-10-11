"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { canPrefetch, loadBrowserResource } from "@/browser/resources";
import {
  readPersistentResource,
  persistResource,
} from "@/browser/persistent-resources";
import type { ResourcePriority } from "@/lib/resource-cache";
import type { MapViewData } from "@/domain/map/schema";
import { VISION_SCENE_FORMAT } from "@/domain/map/vision";

export function useMapVisionResource(data: MapViewData) {
  const descriptor = data.visionResource;
  const [scene, setScene] = useState(data.visionScene);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    scene ? "ready" : "idle",
  );
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const load = useCallback(
    async (priority: ResourcePriority = "foreground") => {
      if (!descriptor || data.visionScene) return;
      if (priority === "foreground") setStatus("loading");
      // Maps have their own checksum-bound authority, including map-only workspaces.
      const root = document.documentElement.dataset;
      const key = JSON.stringify([
        "map-vision",
        root.environment,
        root.dataClass,
        root.environmentRun,
        root.environmentFingerprint,
        descriptor.url,
        VISION_SCENE_FORMAT,
      ]);
      try {
        const payload = await loadBrowserResource(
          key,
          async () => {
            const cached =
              await readPersistentResource<
                NonNullable<MapViewData["visionScene"]>
              >(key);
            if (cached?.datasetRevision === descriptor.datasetRevision)
              return cached;
            const response = await fetch(descriptor.url, {
              signal: AbortSignal.timeout(30_000),
            });
            const value = await response.json();
            if (
              !response.ok ||
              value.format !== VISION_SCENE_FORMAT ||
              value.datasetRevision !== descriptor.datasetRevision ||
              !value.scene?.bounds ||
              !Array.isArray(value.scene.trees)
            )
              throw new Error("Invalid map vision resource");
            void persistResource(
              key,
              JSON.stringify([
                "map-vision",
                root.environment,
                root.environmentRun,
              ]),
              value,
            );
            return value as NonNullable<MapViewData["visionScene"]>;
          },
          priority,
        );
        if (mounted.current) {
          setScene(payload);
          setStatus("ready");
        }
      } catch {
        if (mounted.current) setStatus("error");
      }
    },
    [descriptor, data.visionScene],
  );
  useEffect(() => {
    if (!descriptor || data.visionScene || !canPrefetch()) return;
    const timer = window.setTimeout(() => {
      void load("background");
    }, 250);
    return () => clearTimeout(timer);
  }, [descriptor, data.visionScene, load]);
  return { scene, status, load };
}
