import {
  developmentEnabled,
  developmentRequestAllowed,
} from "@/development/request";
import {
  databaseOverview,
  databaseRecords,
  databaseImage,
} from "@/development/data-sync/view";
export const dynamic = "force-dynamic";
export async function GET(request: Request): Promise<Response> {
  if (!developmentEnabled()) return new Response(null, { status: 404 });
  if (!developmentRequestAllowed(request.headers))
    return new Response(null, { status: 403 });
  const params = new URL(request.url).searchParams;
  try {
    if (params.has("image")) return await databaseImage(params.get("image")!);
    const result = params.has("table")
      ? await databaseRecords(params)
      : await databaseOverview();
    return Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error(
      "Database inspector request failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      {
        error: "无法读取：请核对表名、筛选条件和当前环境；详细原因见开发日志。",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
