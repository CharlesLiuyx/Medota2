import { getActiveCatalogMeta } from "@/server/repositories/heroes";
import { getWebDatabase } from "@/server/db/client";
import {
  getDeclaredPublicEnvironment,
  toPublicEnvironmentIdentity,
} from "@/server/environment/contract";
import { createEnvironmentResponseHeaders } from "@/server/environment/public-projection";
import { REPLICA_SCHEMA } from "@/domain/catalog-replica";
import { listProblemResponse } from "../request";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  try {
    const db = await getWebDatabase();
    const identity = toPublicEnvironmentIdentity(await db.verifyIdentity());
    const meta = await getActiveCatalogMeta();
    const head = meta
      ? {
          datasetVersionId: meta.datasetVersionId,
          assetDatasetVersionId: meta.assetDatasetVersionId,
        }
      : null;
    const etag = `"catalog:${REPLICA_SCHEMA}:${head?.datasetVersionId ?? "none"}:${head?.assetDatasetVersionId ?? "none"}"`;
    const headers = createEnvironmentResponseHeaders(identity, { ETag: etag });
    if (request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    return Response.json(head, { headers });
  } catch (error) {
    return listProblemResponse(error, getDeclaredPublicEnvironment());
  }
}
