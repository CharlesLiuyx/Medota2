import { getAbilityCatalogSlice } from "@/server/repositories/abilities";
import { parseAbilityFilters } from "@/server/services/ability-filters";
import { ListRequestError } from "@/server/services/catalog-cursor";
import { listProblemResponse, parseListRouteRequest } from "../request";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const { params, sliceRequest } = parseListRouteRequest(
      new URL(request.url),
    );
    const parsed = parseAbilityFilters(params);
    if (parsed.errors.length) {
      throw new ListRequestError(parsed.errors.join(" "));
    }
    const slice = await getAbilityCatalogSlice(parsed.filters, sliceRequest);
    return Response.json(slice, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return listProblemResponse(error);
  }
}
