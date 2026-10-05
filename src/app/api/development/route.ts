import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { developmentRoot, readJson, writeJson } from "@/development/runtime";
import type { WorkbenchStatus } from "@/development/protocol";

export const dynamic = "force-dynamic";
function enabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.MEDOTA2_WORKBENCH === "1" &&
    ["development", "local-review"].includes(
      process.env.MEDOTA2_ENVIRONMENT ?? "",
    )
  );
}
export async function GET(): Promise<Response> {
  if (!enabled()) return new Response(null, { status: 404 });
  const status = await readJson<WorkbenchStatus>(
    resolve(developmentRoot, "status.json"),
  );
  return Response.json(status, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request): Promise<Response> {
  if (!enabled()) return new Response(null, { status: 404 });
  // Next dev can normalize request.url to localhost even when the browser used
  // 127.0.0.1. Compare the original Host, restricted to this loopback workbench.
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (
    !["127.0.0.1:3000", "localhost:3000"].includes(host) ||
    request.headers.get("origin") !== `http://${host}`
  )
    return new Response(null, { status: 403 });
  const body = (await request.json().catch(() => null)) as {
    action?: string;
  } | null;
  if (!body || !["cancel", "rerun"].includes(body.action ?? ""))
    return new Response(null, { status: 400 });
  const status = await readJson<WorkbenchStatus>(
    resolve(developmentRoot, "status.json"),
  );
  if (!status || status.phase !== "ready")
    return new Response(null, { status: 409 });
  await writeJson(resolve(developmentRoot, "command.json"), {
    action: body.action,
    instance: status.instance,
    id: randomUUID(),
  });
  return Response.json({ accepted: true }, { status: 202 });
}
