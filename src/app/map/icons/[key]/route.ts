import { readMapPackageIcon } from "@/server/map/package-icons";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params,
    query = new URL(request.url).searchParams,
    hash = query.get("v"),
    rawWidth = query.get("width");
  if (
    !/^[a-z0-9_]{1,200}$/u.test(key) ||
    !hash ||
    !/^[a-f0-9]{64}$/u.test(hash)
  )
    return new Response("Invalid minimap asset identity.", { status: 400 });
  if (
    rawWidth !== null &&
    (!/^\d+$/u.test(rawWidth) ||
      Number(rawWidth) < 1 ||
      Number(rawWidth) > 4096)
  )
    return new Response("Invalid asset width.", { status: 400 });
  const asset = await readMapPackageIcon(
    key,
    hash,
    rawWidth === null ? null : Number(rawWidth),
  );
  if (!asset)
    return new Response("Minimap image not imported.", { status: 404 });
  const etag = `"${asset.content_sha256}"`,
    headers = {
      ETag: etag,
      "Cache-Control": "private, max-age=31536000, immutable",
    };
  if (
    request.headers
      .get("if-none-match")
      ?.split(",")
      .some(
        (value) =>
          value.trim().replace(/^W\//u, "") === etag || value.trim() === "*",
      )
  )
    return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(asset.content), {
    headers: {
      ...headers,
      "Content-Type": asset.mime_type,
      "Content-Length": String(asset.content.byteLength),
      "X-Medota2-Asset-Path": asset.logical_path,
    },
  });
}
