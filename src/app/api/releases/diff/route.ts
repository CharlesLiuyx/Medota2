import { getEntityVersionDiff } from "@/server/services/entity-version-diff";
import { canonicalReleaseId, readReleaseParameter } from "@/domain/releases";
import { getReleaseIndex } from "@/server/services/releases";
import { getWebDatabase } from "@/server/db/client";
import {
  getDeclaredPublicEnvironment,
  toPublicEnvironmentIdentity,
} from "@/server/environment/contract";
import {
  catalogJsonResponse,
  listProblemResponse,
} from "@/app/api/catalog/request";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const db = await getWebDatabase();
    const identity = toPublicEnvironmentIdentity(await db.verifyIdentity());
    const params = new URL(request.url).searchParams;
    let from: string | undefined, to: string | undefined;
    try {
      from = readReleaseParameter(
        params.getAll("from").length > 1
          ? params.getAll("from")
          : (params.get("from") ?? undefined),
      );
      to = readReleaseParameter(
        params.getAll("to").length > 1
          ? params.getAll("to")
          : (params.get("to") ?? undefined),
      );
    } catch {
      return catalogJsonResponse({ message: "版本参数无效。" }, identity, 400);
    }
    if (!from || !to)
      return catalogJsonResponse(
        { message: "必须指定from和to版本。" },
        identity,
        400,
      );
    const index = await getReleaseIndex();
    from = canonicalReleaseId(index, from);
    to = canonicalReleaseId(index, to);
    if (![from, to].every((id) => index.releases.some((r) => r.id === id)))
      return catalogJsonResponse({ message: "版本未收录。" }, identity, 404);
    return catalogJsonResponse(await getEntityVersionDiff(from, to), identity);
  } catch (error) {
    return listProblemResponse(error, getDeclaredPublicEnvironment());
  }
}
