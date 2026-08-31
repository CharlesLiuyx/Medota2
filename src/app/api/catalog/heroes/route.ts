import { getHeroCatalogSlice } from "@/server/repositories/heroes";
import { getWebDatabase } from "@/server/db/client";
import {
  getDeclaredPublicEnvironment,
  toPublicEnvironmentIdentity,
} from "@/server/environment/contract";
import { ListRequestError } from "@/server/services/catalog-cursor";
import { parseHeroFilters } from "@/server/services/hero-filters";
import {
  catalogJsonResponse,
  listProblemResponse,
  parseListRouteRequest,
} from "../request";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const declaredEnvironment = getDeclaredPublicEnvironment();
  try {
    const { params, sliceRequest } = parseListRouteRequest(
      new URL(request.url),
    );
    const parsed = parseHeroFilters(params);
    if (parsed.errors.length) {
      throw new ListRequestError(parsed.errors.join(" "));
    }
    const slice = await getHeroCatalogSlice(parsed.filters, sliceRequest);
    const database = await getWebDatabase();
    const identity = toPublicEnvironmentIdentity(
      await database.verifyIdentity(),
    );
    return catalogJsonResponse(slice, identity);
  } catch (error) {
    return listProblemResponse(error, declaredEnvironment);
  }
}
