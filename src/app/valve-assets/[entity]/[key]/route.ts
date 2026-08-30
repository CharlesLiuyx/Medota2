import { readValveAsset } from "@/server/assets/valve-assets";
import { getActiveAbilityTexture } from "@/server/repositories/abilities";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ entity: string; key: string }> },
): Promise<Response> {
  const { entity, key } = await params;
  if (entity !== "hero" && entity !== "ability") {
    return new Response("Unknown asset entity.", { status: 404 });
  }
  const logicalName =
    entity === "hero"
      ? key.replace(/^npc_dota_hero_/u, "")
      : await getActiveAbilityTexture(key);
  if (!logicalName)
    return new Response("Asset reference not found.", { status: 404 });
  const asset = await readValveAsset(entity, logicalName);
  if (!asset)
    return new Response("Local Valve asset not available.", { status: 404 });
  if (request.headers.get("if-none-match") === `"${asset.sha256}"`) {
    return new Response(null, { status: 304 });
  }
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.bytes.byteLength),
      ETag: `"${asset.sha256}"`,
      "Cache-Control": "private, max-age=3600",
      "X-Medota2-Asset-Path": asset.logicalPath,
    },
  });
}
