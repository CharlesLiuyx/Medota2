import { LOCALES } from "../../src/i18n/config";
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
    // Global navigation includes these modules. Compile their locale payloads
    // before measuring UI behavior, just as the catalog warmup does above.
    for (const route of ["units", "items", "map", "changes", "attributes"]) {
      for (const locale of LOCALES) {
        const response = await fetch(`${origin}/${route}?lang=${locale}`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok)
          throw new Error(
            `Browser warmup ${route}/${locale}: ${response.status}`,
          );
        await response.arrayBuffer();
        if (route === "attributes") {
          const release = new URL(response.url).searchParams.get("release");
          if (release) {
            const catalog = await fetch(
              `${origin}/api/attributes?${new URLSearchParams({ release })}`,
              { signal: AbortSignal.timeout(30_000) },
            );
            if (!catalog.ok)
              throw new Error(
                `Browser warmup attributes API: ${catalog.status}`,
              );
            await catalog.arrayBuffer();
          }
        }
      }
    }
  }
}
