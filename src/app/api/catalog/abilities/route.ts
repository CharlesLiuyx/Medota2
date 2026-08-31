import { getAbilityCatalogSlice } from "@/server/repositories/abilities";
import { getWebDatabase } from "@/server/db/client";
import {
  getDeclaredPublicEnvironment,
  toPublicEnvironmentIdentity,
} from "@/server/environment/contract";
import { parseAbilityFilters } from "@/server/services/ability-filters";
import { ListRequestError } from "@/server/services/catalog-cursor";
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
    const parsed = parseAbilityFilters(params);
    if (parsed.errors.length) {
      throw new ListRequestError(parsed.errors.join(" "));
    }
    const slice = await getAbilityCatalogSlice(parsed.filters, sliceRequest);
    const database = await getWebDatabase();
    const identity = toPublicEnvironmentIdentity(
      await database.verifyIdentity(),
    );
    return catalogJsonResponse(slice, identity);
  } catch (error) {
    return listProblemResponse(error, declaredEnvironment);
  }
}
