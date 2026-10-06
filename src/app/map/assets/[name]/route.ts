import { readMapImage } from "@/server/map/store";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ name: string }> },
) {
  if ((await context.params).name !== "overview.webp")
    return new Response(null, { status: 404 });
  try {
    const asset = await readMapImage();
    if (!asset || new URL(request.url).searchParams.get("v") !== asset.revision)
      return new Response(null, { status: 404 });
    const headers = {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: `"${asset.sha256}"`,
      "X-Content-Type-Options": "nosniff",
    };
    if (request.headers.get("if-none-match") === headers.ETag)
      return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(asset.bytes), { headers });
  } catch {
    return new Response(null, { status: 503 });
  }
}
