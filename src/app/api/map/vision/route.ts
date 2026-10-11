import { readMapPackage } from "@/server/map/store";
import { readVisionScene } from "@/server/map/vision";
import { VISION_SCENE_FORMAT } from "@/domain/map/vision";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const revision = params.get("revision");
  if (
    !revision ||
    !/^[a-f0-9]{64}$/.test(revision) ||
    params.get("format") !== VISION_SCENE_FORMAT ||
    ["version", "revision", "format"].some(
      (key) => params.getAll(key).length > 1,
    )
  )
    return Response.json(
      { message: "Invalid vision resource identity" },
      { status: 400 },
    );
  try {
    const pkg = await readMapPackage(params.get("version") || undefined);
    if (!pkg)
      return Response.json({ message: "Map unavailable" }, { status: 404 });
    if (pkg.revision !== revision)
      return Response.json(
        { message: "Map revision changed" },
        { status: 409 },
      );
    const prepared = await readVisionScene(pkg.root);
    if (prepared.identity.datasetRevision !== revision)
      throw new Error("Vision revision mismatch");
    return Response.json(
      {
        format: VISION_SCENE_FORMAT,
        datasetRevision: revision,
        scene: prepared.scene,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("Vision resource rejected", error);
    return Response.json(
      { message: "Vision source validation failed" },
      { status: 500 },
    );
  }
}
