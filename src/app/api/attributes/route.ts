import { resolveRelease } from "@/server/services/releases";
import { getAttributeOverview } from "@/server/repositories/attributes";
import {
  attributeSlice,
  parseAttributeQuery,
} from "@/server/services/attribute-catalog";
import {
  ListCursorError,
  ListRequestError,
} from "@/server/services/catalog-cursor";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = parseAttributeQuery(params);
    const release = params.get("release");
    if (!release) throw new ListRequestError("A pinned release is required");
    const selected = await resolveRelease(release);
    if (!selected?.catalogId)
      return Response.json(
        {
          code: "dataset_unavailable",
          message: "Attribute catalog unavailable",
        },
        { status: 404 },
      );
    const { meta, snapshot } = await getAttributeOverview(selected.catalogId);
    if (!meta || !snapshot)
      return Response.json(
        {
          code: "dataset_unavailable",
          message: "Attribute catalog unavailable",
        },
        { status: 404 },
      );
    return Response.json(
      attributeSlice(snapshot.summaries, meta.datasetVersionId, query, {
        after: params.get("after") ?? undefined,
        before: params.get("before") ?? undefined,
      }),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof ListCursorError || error instanceof ListRequestError)
      return Response.json(
        { code: error.code, message: error.message },
        { status: 400 },
      );
    // Preserve Next's not-found response for an unknown release.
    if (error instanceof Error && "digest" in error) throw error;
    console.error("Attribute catalog read failed", error);
    return Response.json(
      { code: "query_failed", message: "Attribute catalog read failed" },
      { status: 500 },
    );
  }
}
