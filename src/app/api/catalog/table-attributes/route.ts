import { resolveRelease } from "@/server/services/releases";
import { getAttributeOverview } from "@/server/repositories/attributes";
import { buildCatalogAttributeMatrix } from "@/presentation/catalog-table-columns";
import type { AttributeEntry, AttributeOwnerKind } from "@/domain/attributes";
import { sha256 } from "@/lib/hash";
import { getWebDatabase } from "@/server/db/client";
import { toPublicEnvironmentIdentity } from "@/server/environment/contract";
import { catalogJsonResponse } from "../request";

export const dynamic = "force-dynamic";
// The weak key has the same lifetime as the validated immutable source snapshot.
const revisions = new WeakMap<readonly AttributeEntry[], string>();
async function read(request: Request) {
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
    const db = await getWebDatabase();
    const identity = toPublicEnvironmentIdentity(await db.verifyIdentity());
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
    let revision = revisions.get(snapshot.entries);
    if (!revision) {
      revision = sha256(JSON.stringify(snapshot.entries));
      revisions.set(snapshot.entries, revision);
    }
    const resourceId = `table-attributes/2:${identity.safeFingerprint}:${meta.datasetVersionId}:${revision}:${kind}`;
    let columns = new Set<string>();
    if (request.method === "POST") {
      const text = await request.text();
      if (text.length > 1_000_000)
        return Response.json({ message: "Query too large" }, { status: 400 });
      const body = JSON.parse(text);
      if (body.resourceId !== resourceId)
        return Response.json(
          { message: "Attribute source changed; reload the column manifest" },
          { status: 409 },
        );
      if (
        !Array.isArray(body.columns) ||
        body.columns.length > 2000 ||
        !body.columns.every(
          (key: unknown) => typeof key === "string" && key.length <= 2048,
        )
      )
        return Response.json({ message: "Invalid columns" }, { status: 400 });
      columns = new Set(body.columns);
    }
    const matrix = buildCatalogAttributeMatrix(snapshot.entries, kind, columns);
    if (request.method === "POST") {
      const known = new Set(matrix.columns.map((column) => column.key));
      if ([...columns].some((key) => !known.has(key)))
        return Response.json(
          { message: "Unknown attribute column" },
          { status: 400 },
        );
      return catalogJsonResponse(
        {
          version: 2,
          resourceId,
          loadedColumns: [...columns],
          values: matrix.values,
        },
        identity,
      );
    }
    return catalogJsonResponse(
      {
        version: 2,
        release,
        kind,
        datasetVersionId: meta.datasetVersionId,
        resourceId,
        columns: matrix.columns,
      },
      identity,
    );
  } catch (error) {
    if (error instanceof Error && "digest" in error) throw error;
    if (error instanceof SyntaxError)
      return Response.json({ message: "Invalid JSON" }, { status: 400 });
    console.error("Catalog table attributes read failed", error);
    return Response.json(
      { message: "Attribute query failed" },
      { status: 500 },
    );
  }
}
export const GET = read;
export const POST = read;
