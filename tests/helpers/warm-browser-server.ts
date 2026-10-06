import type { FullConfig } from "@playwright/test";
import { warmCatalogRoutes } from "../../src/development/warm-catalog";

// Playwright starts webServer before globalSetup. Match the workbench's route
// readiness so cold compilation does not consume navigation assertion time.
export default async function warmBrowserServer(config: FullConfig) {
  const origins = new Set(
    config.projects.map((project) => project.use.baseURL),
  );
  for (const origin of origins) {
    if (!origin)
      throw new Error("Browser warmup requires a configured baseURL.");
    await warmCatalogRoutes(origin);
  }
}
