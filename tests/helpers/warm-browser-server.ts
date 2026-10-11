import type { FullConfig } from "@playwright/test";
import { warmBrowserOrigin } from "../../src/development/warm-browser";

export default async function warmBrowserServer(config: FullConfig) {
  // The browser lane owns and warms one server for the complete selected batch.
  if (process.env.MEDOTA2_FIXTURE_BROWSER_BATCH === "1") return;
  const origins = new Set(
    config.projects.map((project) => project.use.baseURL),
  );
  for (const origin of origins) {
    if (!origin)
      throw new Error("Browser warmup requires a configured baseURL.");
    await warmBrowserOrigin(
      origin,
      process.env.MEDOTA2_BROWSER_WARM_SCOPES?.split(","),
    );
  }
}
