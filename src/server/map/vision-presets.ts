import "server-only";
import { getHeroMapAssets } from "@/server/repositories/hero-map-assets";
import { heroMinimapUrl } from "./hero-icons";
import { packageIconUrl, hasNativeMapIcons } from "./package-icons";
import type { ActiveDatasetMeta } from "@/server/repositories/heroes";
import { getWebDatabase } from "@/server/db/client";
import { getItemOverview } from "@/server/repositories/items";
import type { VisionPreset } from "@/domain/map/vision-sources";

/** Selected Release Catalog and its asset heads; never fall back to active head. */
export async function readVisionPresets(meta: ActiveDatasetMeta) {
  const db = await getWebDatabase();
  const [heroes, items, heroAssets] = await Promise.all([
    db.query<{
      key: string;
      zhName: string;
      enName: string;
      day: string;
      night: string;
      baseMovementSpeed: string | null;
    }>(
      `SELECT h.internal_name AS key, zh.display_name AS "zhName", en.display_name AS "enName", h.day_vision AS day, h.night_vision AS night, h.movement_speed AS "baseMovementSpeed" FROM heroes h JOIN hero_localizations zh ON zh.dataset_version_id=h.dataset_version_id AND zh.hero_id=h.hero_id AND zh.locale='zh-CN' JOIN hero_localizations en ON en.dataset_version_id=h.dataset_version_id AND en.hero_id=h.hero_id AND en.locale='en' WHERE h.dataset_version_id=$1 AND h.enabled=true ORDER BY h.hero_id`,
      [meta.datasetVersionId],
    ),
    getItemOverview(meta.datasetVersionId),
    getHeroMapAssets(meta),
  ]);
  const value = (key: string, field: string) => {
    const raw = items.snapshot?.items
      .find((i) => i.internalName === key)
      ?.stats.find((s) => s.key === field)?.value;
    if (!raw?.trim()) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 32768 ? n : null;
  };
  const presets: VisionPreset[] = [
    ...(["observer", "sentry"] as const).map((kind) => {
      const key = `item_ward_${kind}`;
      const radius = value(
        key,
        kind === "observer" ? "vision_range_tooltip" : "vision_range",
      );
      return {
        key,
        kind,
        zhName: kind === "observer" ? "侦查守卫" : "岗哨守卫",
        enName: kind === "observer" ? "Observer Ward" : "Sentry Ward",
        imageUrl: hasNativeMapIcons(meta)
          ? packageIconUrl(`devilesk_ward_${kind}`)
          : items.imageVersion
            ? `/valve-assets/item/${key}?v=${items.imageVersion}`
            : null,
        imageAnchor: hasNativeMapIcons(meta) ? ([0.5, 1] as const) : undefined,
        day: radius,
        night: radius,
        detection: kind === "sentry" ? value(key, "true_sight_range") : 0,
      };
    }),
    ...heroes.rows.map((h) => ({
      ...h,
      collisionRadius: heroAssets.get(h.key)?.collisionRadius ?? null,
      kind: "hero" as const,
      day: Number(h.day),
      night: Number(h.night),
      baseMovementSpeed:
        h.baseMovementSpeed?.trim() &&
        Number.isFinite(Number(h.baseMovementSpeed))
          ? Number(h.baseMovementSpeed)
          : null,
      detection: 0,
      imageUrl: heroAssets.get(h.key)?.imageUrl ?? heroMinimapUrl(meta, h.key),
    })),
  ];
  return {
    catalogId: meta.datasetVersionId,
    clientVersion: meta.clientVersion,
    sourceCommit: meta.sourceCommit,
    presets,
  };
}
