import { getWorkbenchPort } from "@/config/data-sync-state";

export function developmentEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.MEDOTA2_WORKBENCH === "1" &&
    ["development", "local-review"].includes(
      process.env.MEDOTA2_ENVIRONMENT ?? "",
    )
  );
}
export function developmentRequestAllowed(
  headers: Headers,
  mutation = false,
): boolean {
  const port = getWorkbenchPort();
  const allowed = new Set([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
  ]);
  const configured = process.env.MEDOTA2_WORKBENCH_BROWSER_ORIGIN;
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        url.protocol !== "http:" ||
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.username ||
        url.password ||
        url.origin !== configured
      )
        return false;
      allowed.add(url.origin);
    } catch {
      return false;
    }
  }
  const origin = `http://${headers.get("host") ?? ""}`;
  if (!allowed.has(origin)) return false;
  const supplied = headers.get("origin");
  if ((mutation || supplied) && supplied !== origin) return false;
  const site = headers.get("sec-fetch-site");
  return site === null || site === "none" || site === "same-origin";
}
