import { getEntityVersionDiff } from "@/server/services/entity-version-diff";
import { getReleaseIndex } from "@/server/services/releases";
import { getReleaseChangesView } from "@/server/services/release-changes";
import {
  prepareChangeResources,
  readChangeResource,
} from "@/server/services/change-resources";
import { isLocale } from "@/i18n/locale";
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
    const identity = toPublicEnvironmentIdentity(
      await (await getWebDatabase()).verifyIdentity(),
    );
    const params = new URL(request.url).searchParams;
    const resourceId = params.get("resource") ?? "",
      locale = params.get("lang");
    if (
      !isLocale(locale) ||
      !/^[a-f0-9]{64}$/.test(resourceId) ||
      [...params.keys()].some((key) => params.getAll(key).length !== 1)
    )
      return catalogJsonResponse(
        { message: "Invalid change resource" },
        identity,
        400,
      );
    const releases = (await getReleaseIndex()).releases;
    const from = releases.find((release) => release.id === params.get("from"));
    const to = releases.find((release) => release.id === params.get("to"));
    if (!from || !to)
      return catalogJsonResponse(
        { message: "Release unavailable" },
        identity,
        404,
      );
    const diff = await getEntityVersionDiff(from.id, to.id);
    let resource = readChangeResource(resourceId, diff, locale);
    if (!resource) {
      const rebuilt = prepareChangeResources(
        diff,
        await getReleaseChangesView(from, to, diff.changes, locale),
        locale,
      );
      if (rebuilt.resourceId === resourceId) resource = rebuilt.bundle;
    }
    if (!resource)
      return catalogJsonResponse(
        { message: "Change projection changed; refresh the page" },
        identity,
        409,
      );
    if (params.get("audit") === "1")
      return catalogJsonResponse(
        { technical: resource.technical, unresolved: resource.unresolved },
        identity,
      );
    const row = resource.groups
      .find((group) => group.key === params.get("group"))
      ?.rows.find((row) => row.key === params.get("row"));
    if (!row)
      return catalogJsonResponse(
        { message: "Evidence unavailable" },
        identity,
        404,
      );
    return catalogJsonResponse(row.evidence, identity);
  } catch (error) {
    return listProblemResponse(error, getDeclaredPublicEnvironment());
  }
}
