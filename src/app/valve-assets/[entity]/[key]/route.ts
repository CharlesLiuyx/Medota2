import { getActiveEntityIcon } from "@/server/repositories/assets";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ entity: string; key: string }> },
): Promise<Response> {
  const { entity, key } = await params;
  if (entity !== "hero" && entity !== "ability") {
    return new Response("Unknown asset entity.", { status: 404 });
  }
  if (!/^[a-z0-9_]+$/u.test(key)) {
    return new Response("Invalid asset key.", { status: 400 });
  }
  const width = requestedWidth(request);
  if (width === undefined) {
    return new Response("Invalid asset width.", { status: 400 });
  }
  const asset = await getActiveEntityIcon(entity, key, width);
  if (!asset)
    return new Response("Database asset not available.", { status: 404 });
  const etag = `"${asset.contentSha256}"`;
  // Asset URLs remain stable while the database head is versioned. Keep bytes
  // in the browser cache, but always revalidate so a promoted dataset is
  // visible immediately instead of serving the previous icon for an hour.
  const cacheControl = "private, no-cache";
  if (matchesEtag(request.headers.get("if-none-match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": cacheControl },
    });
  }
  return new Response(new Uint8Array(asset.content), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(asset.content.byteLength),
      ETag: etag,
      "Cache-Control": cacheControl,
      "X-Medota2-Asset-Path": asset.logicalPath,
      "X-Medota2-Asset-LoD": asset.lodKey,
    },
  });
}

function requestedWidth(request: Request): number | null | undefined {
  const value = new URL(request.url).searchParams.get("width");
  if (value === null) return null;
  if (!/^\d+$/u.test(value)) return undefined;
  const width = Number(value);
  return Number.isSafeInteger(width) && width > 0 && width <= 4096
    ? width
    : undefined;
}

function matchesEtag(value: string | null, etag: string): boolean {
  if (!value) return false;
  return value.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return (
      normalized === "*" || normalized === etag || normalized === `W/${etag}`
    );
  });
}
