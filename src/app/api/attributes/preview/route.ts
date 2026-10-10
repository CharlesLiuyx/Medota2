import { resolveRelease } from "@/server/services/releases";
import { getAttributeOverview } from "@/server/repositories/attributes";
import { attributeFormula } from "@/domain/attribute-mechanics";
import { attributeValueEffects } from "@/presentation/attribute-value-effects";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release"),
    id = params.get("id");
  if (
    !release ||
    !id ||
    params.getAll("release").length !== 1 ||
    params.getAll("id").length !== 1
  )
    return Response.json(
      { message: "A pinned release and attribute are required" },
      { status: 400 },
    );
  try {
    const selected = await resolveRelease(release);
    if (!selected?.catalogId)
      return Response.json({ message: "Catalog unavailable" }, { status: 404 });
    const { meta, snapshot } = await getAttributeOverview(selected.catalogId);
    if (!meta || !snapshot)
      return Response.json(
        { message: "Attribute source unavailable" },
        { status: 503 },
      );
    const attribute = snapshot.entries.find((entry) => entry.id === id);
    if (!attribute)
      return Response.json(
        { message: "Attribute unavailable" },
        { status: 404 },
      );
    const formula = attributeFormula(id, meta.sourceCommit);
    return Response.json(
      {
        release,
        id,
        datasetVersionId: meta.datasetVersionId,
        summary: attribute.summary,
        scope: attribute.scope,
        unit: attribute.unit,
        formula,
        effects: attributeValueEffects(
          id,
          params.get("value") ?? undefined,
          Boolean(formula),
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && "digest" in error) throw error;
    console.error("Attribute preview read failed", error);
    return Response.json(
      { message: "Attribute query failed" },
      { status: 500 },
    );
  }
}
