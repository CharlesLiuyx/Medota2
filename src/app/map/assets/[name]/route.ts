import { readMapImage } from "@/server/map/store";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: { params: Promise<{ name: string }> },
) {
  const name = (await context.params).name;
  if (!["overview.webp", "navigation.webp", "height.webp"].includes(name))
    return new Response(null, { status: 404 });
  try {
    const query = new URL(request.url).searchParams;
    const asset = await readMapImage(
      query.get("version") ?? undefined,
      name,
      query.get("v"),
    );
    if (!asset) return new Response(null, { status: 404 });
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
