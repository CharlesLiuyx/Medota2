import { getHeroStatusCatalog } from "@/server/services/hero-status-catalog";
import { catalogJsonResponse } from "../request";
import { getWebDatabase } from "@/server/db/client";
import {
  getDeclaredPublicEnvironment,
  toPublicEnvironmentIdentity,
} from "@/server/environment/contract";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const dataset = url.searchParams.get("dataset");
  if (
    !dataset ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(
      dataset,
    ) ||
    [...url.searchParams.keys()].some((k) => k !== "dataset") ||
    url.searchParams.getAll("dataset").length !== 1
  )
    return catalogJsonResponse(
      { error: "Invalid dataset" },
      getDeclaredPublicEnvironment(),
      400,
    );
  try {
    const catalog = await getHeroStatusCatalog(dataset);
    const db = await getWebDatabase();
    const identity = toPublicEnvironmentIdentity(await db.verifyIdentity());
    return catalog
      ? catalogJsonResponse(catalog, identity)
      : catalogJsonResponse({ error: "Catalog unavailable" }, identity, 404);
  } catch {
    return catalogJsonResponse(
      { error: "Status source unavailable" },
      getDeclaredPublicEnvironment(),
      503,
    );
  }
}
