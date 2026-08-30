import { getHeroCatalogSlice } from "@/server/repositories/heroes";
import { ListRequestError } from "@/server/services/catalog-cursor";
import { parseHeroFilters } from "@/server/services/hero-filters";
import { listProblemResponse, parseListRouteRequest } from "../request";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { params, sliceRequest } = parseListRouteRequest(
      new URL(request.url),
    );
    const parsed = parseHeroFilters(params);
    if (parsed.errors.length) {
      throw new ListRequestError(parsed.errors.join(" "));
    }
    const slice = await getHeroCatalogSlice(parsed.filters, sliceRequest);
    return Response.json(slice, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return listProblemResponse(error);
  }
}
