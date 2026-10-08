import { warmRoutesForScopes } from "../../scripts/development/check-plan.mjs";
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
    // Dev HTML/RSC rendering does not compile the browser's route chunks.
    // Fetch the scripts used by each catalog's first detail before timing clicks.
    const warmedScripts = new Set<string>();
    for (const entity of ["heroes", "abilities"] as const) {
      const response = await fetch(`${origin}/api/catalog/${entity}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error(`Browser warmup ${entity} API: ${response.status}`);
      const catalog = (await response.json()) as {
        items: Array<{ slug?: string; internalName?: string }>;
      };
      const id =
        entity === "heroes"
          ? catalog.items[0]?.slug
          : catalog.items[0]?.internalName;
      const paths = [`/${entity}`];
      if (id) paths.push(`/${entity}/${encodeURIComponent(id)}`);
      for (const path of paths) {
        const page = await fetch(`${origin}${path}`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (!page.ok) throw new Error(`Browser warmup ${path}: ${page.status}`);
        const html = await page.text();
        for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gu)) {
          const source = match[1];
          if (
            !source.startsWith("/_next/static/chunks/") ||
            warmedScripts.has(source)
          )
            continue;
          const script = await fetch(new URL(source, origin), {
            signal: AbortSignal.timeout(30_000),
          });
          if (!script.ok)
            throw new Error(`Browser warmup ${source}: ${script.status}`);
          await script.arrayBuffer();
          warmedScripts.add(source);
        }
      }
    }
    // Global navigation includes these modules. Compile their locale payloads
    // before measuring UI behavior, just as the catalog warmup does above.
    for (const route of warmRoutesForScopes(
      process.env.MEDOTA2_BROWSER_WARM_SCOPES?.split(","),
    )) {
      for (const locale of LOCALES) {
        const response = await fetch(`${origin}/${route}?lang=${locale}`, {
          signal: AbortSignal.timeout(30_000),
        });
        if (
          !response.ok &&
          !(route === "dev/database" && response.status === 404)
        )
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
    const headResponse = await fetch(`${origin}/api/catalog/head`);
    if (!headResponse.ok)
      throw new Error(`Browser warmup head: ${headResponse.status}`);
    const head = await headResponse.json();
    for (const entity of ["heroes", "abilities"]) {
      const response = await fetch(`${origin}/api/catalog/replica`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...head, entity, locale: "en", known: [] }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error(
          `Browser warmup replica ${entity}/en: ${response.status}`,
        );
      await response.arrayBuffer();
    }
  }
}
