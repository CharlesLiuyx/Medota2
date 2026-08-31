import { getOptionalValue } from "@/config/env";
import { assertOutboundNetworkAllowed } from "@/config/network-policy";

export async function notifyCatalogEvent(event: {
  status: "no_change" | "succeeded" | "failed";
  commit?: string;
  detail?: string;
}): Promise<void> {
  const record = {
    type: "medota2.catalog.refresh",
    at: new Date().toISOString(),
    ...event,
  };
  console.log(JSON.stringify(record));
  const webhook = getOptionalValue("CATALOG_NOTIFICATION_WEBHOOK_URL");
  if (!webhook) return;
  const parsed = new URL(webhook);
  if (parsed.protocol !== "https:") {
    throw new Error("CATALOG_NOTIFICATION_WEBHOOK_URL must use https://.");
  }
  assertOutboundNetworkAllowed(parsed, "Catalog notification adapter");
  const response = await fetch(parsed, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `Catalog notification failed with HTTP ${response.status}.`,
    );
  }
}
