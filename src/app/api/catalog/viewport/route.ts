import {
  VIEWPORT_CATALOGS,
  HERO_PORTRAIT_SIZES,
  type ViewportAsset,
  type ViewportCatalog,
} from "@/domain/viewport-assets";
import { getWebDatabase } from "@/server/db/client";
import {
  getDeclaredPublicEnvironment,
  toPublicEnvironmentIdentity,
} from "@/server/environment/contract";
import { getHeroCatalogSlice } from "@/server/repositories/heroes";
import { getAbilityCatalogSlice } from "@/server/repositories/abilities";
import { getUnitOverview, getUnitPortraits } from "@/server/repositories/units";
import { getItemOverview } from "@/server/repositories/items";
import { parseHeroFilters } from "@/server/services/hero-filters";
import { parseAbilityFilters } from "@/server/services/ability-filters";
import { ListRequestError } from "@/server/services/catalog-cursor";
import {
  catalogJsonResponse,
  listProblemResponse,
  resolveListRouteRequest,
} from "../request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    for (const key of url.searchParams.keys()) {
      if (
        !["entity", "limit", "release", "lang"].includes(key) ||
        url.searchParams.getAll(key).length !== 1
      )
        throw new ListRequestError("首屏预热参数无效。");
    }
    const entity = url.searchParams.get("entity") as ViewportCatalog;
    const limit = Number(url.searchParams.get("limit"));
    if (
      !VIEWPORT_CATALOGS.includes(entity) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 192 ||
      !url.searchParams.get("release")
    )
      throw new ListRequestError("首屏预热参数无效。");
    url.searchParams.delete("entity");
    url.searchParams.delete("limit");
    const { params, sliceRequest } = await resolveListRouteRequest(url);
    const db = await getWebDatabase();
    const identity = toPublicEnvironmentIdentity(await db.verifyIdentity());
    const assets: ViewportAsset[] = [];
    if (entity === "heroes" || entity === "abilities") {
      const heroFilters = parseHeroFilters(params);
      const abilityFilters = parseAbilityFilters(params);
      if ((entity === "heroes" ? heroFilters : abilityFilters).errors.length)
        throw new ListRequestError("首屏预热语言无效。");
      // Use the same cursor ordering and asset pair as the visible catalog.
      let after: string | undefined;
      do {
        const slice =
          entity === "heroes"
            ? await getHeroCatalogSlice(heroFilters.filters, {
                ...sliceRequest,
                after,
              })
            : await getAbilityCatalogSlice(abilityFilters.filters, {
                ...sliceRequest,
                after,
              });
        assets.push(
          ...slice.items.slice(0, limit - assets.length).map((item) => ({
            src: `/valve-assets/${entity === "heroes" ? "hero" : "ability"}/${item.internalName}?v=${encodeURIComponent(slice.assetDatasetVersionId)}`,
            sizes: entity === "heroes" ? HERO_PORTRAIT_SIZES : "36px",
          })),
        );
        after = slice.nextCursor ?? undefined;
      } while (after && assets.length < limit);
    } else if (entity === "units") {
      const { meta, snapshot } = await getUnitOverview(
        sliceRequest.catalogDatasetVersionId,
      );
      const portraits = meta
        ? await getUnitPortraits(meta.datasetVersionId)
        : {};
      for (const unit of snapshot?.units.slice(0, limit) ?? []) {
        const portrait = portraits[unit.internalName];
        if (portrait && portrait.resolution !== "unavailable")
          assets.push({
            src: `/valve-assets/unit/${unit.internalName}?v=${portrait.version}`,
            sizes: "36px",
          });
      }
    } else {
      const { snapshot, imageVersion } = await getItemOverview(
        sliceRequest.catalogDatasetVersionId,
      );
      if (imageVersion)
        for (const item of snapshot?.items.slice(0, limit) ?? [])
          assets.push({
            src: `/valve-assets/item/${item.internalName}?v=${imageVersion}`,
            sizes: "44px",
          });
    }
    return catalogJsonResponse({ assets }, identity);
  } catch (error) {
    return listProblemResponse(error, getDeclaredPublicEnvironment());
  }
}
