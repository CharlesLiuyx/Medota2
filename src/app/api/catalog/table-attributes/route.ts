import { resolveRelease } from "@/server/services/releases";
import { getAttributeOverview } from "@/server/repositories/attributes";
import { buildCatalogAttributeMatrix } from "@/presentation/catalog-table-columns";
import type { AttributeOwnerKind } from "@/domain/attributes";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const release = params.get("release");
  const kind = params.get("kind") as AttributeOwnerKind;
  if (
    !release ||
    params.getAll("release").length !== 1 ||
    params.getAll("kind").length !== 1 ||
    !["hero", "ability", "unit", "item"].includes(kind)
  )
    return Response.json(
      { message: "A pinned release and valid entity kind are required" },
      { status: 400 },
    );
  try {
    const selected = await resolveRelease(release);
    if (!selected?.catalogId)
      return Response.json({ message: "Catalog unavailable" }, { status: 404 });
    const { meta, snapshot } = await getAttributeOverview(selected.catalogId);
    if (
      !meta ||
      !snapshot ||
      (kind === "unit" && snapshot.missing.includes("单位")) ||
      (kind === "item" && snapshot.missing.includes("物品"))
    )
      return Response.json(
        { message: "Attribute source unavailable" },
        { status: 503 },
      );
    return Response.json(
      {
        version: 1,
        release,
        kind,
        datasetVersionId: meta.datasetVersionId,
        ...buildCatalogAttributeMatrix(snapshot.entries, kind),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && "digest" in error) throw error;
    console.error("Catalog table attributes read failed", error);
    return Response.json(
      { message: "Attribute query failed" },
      { status: 500 },
    );
  }
}
