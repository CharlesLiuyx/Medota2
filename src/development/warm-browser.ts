import { warmRoutesForScopes } from "../../scripts/development/check-plan.mjs";
import { LOCALES } from "../i18n/config";

export async function warmBrowserOrigin(
  origin: string,
  scopes?: string[],
): Promise<void> {
  const headResponse = await fetch(`${origin}/api/catalog/head`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!headResponse.ok)
    throw new Error(`Browser warmup head: ${headResponse.status}`);
  const head = await headResponse.json();
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
  for (const route of warmRoutesForScopes(scopes)) {
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
            throw new Error(`Browser warmup attributes API: ${catalog.status}`);
          await catalog.arrayBuffer();
        }
      }
    }
  }
  // A table renders its SSR shell before its column manifest is available. Warm
  // the same read-only GET/POST route before the browser's unchanged 5s request
  // assertion, just as we prepare replica routes above. This does not populate
  // browser caches: the test must still request and validate its own columns.
  const release = `c:${head.datasetVersionId}`;
  const tableUrl = `${origin}/api/catalog/table-attributes?${new URLSearchParams({ release, kind: "hero" })}`;
  const tableResponse = await fetch(tableUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!tableResponse.ok)
    throw new Error(`Browser warmup table manifest: ${tableResponse.status}`);
  const manifest = await tableResponse.json();
  if (
    manifest.version !== 2 ||
    manifest.release !== release ||
    manifest.kind !== "hero" ||
    manifest.datasetVersionId !== head.datasetVersionId ||
    typeof manifest.resourceId !== "string" ||
    typeof manifest.columns?.[0]?.key !== "string"
  )
    throw new Error("Browser warmup table manifest has an invalid identity.");
  const valuesResponse = await fetch(tableUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resourceId: manifest.resourceId,
      columns: [manifest.columns[0].key],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!valuesResponse.ok)
    throw new Error(`Browser warmup table values: ${valuesResponse.status}`);
  await valuesResponse.arrayBuffer();
  for (const entity of ["heroes", "abilities"]) {
    for (const locale of LOCALES) {
      const response = await fetch(`${origin}/api/catalog/replica`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...head, entity, locale, known: [] }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok)
        throw new Error(
          `Browser warmup replica ${entity}/${locale}: ${response.status}`,
        );
      await response.arrayBuffer();
    }
  }
}
