/** Compile the shared catalog routes before marking the dev workbench ready.
 * Cold compilation during an in-flight navigation can delay the first visit. This
 * is bounded, read-only warmup; it never creates or publishes game data. */
export async function warmCatalogRoutes(origin: string): Promise<void> {
  const read = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${origin}${path}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(`Catalog warmup ${path}: ${response.status}`);
    return response;
  };
  let head: { datasetVersionId: string; assetDatasetVersionId: string } | null =
    null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      head = await (await read("/api/catalog/head")).json();
      break;
    } catch (error) {
      if (Date.now() + 500 >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  for (const entity of ["heroes", "abilities"] as const) {
    const page = await read(`/${entity}`);
    await page.arrayBuffer();
    if (!head) continue;
    const first = (await (await read(`/api/catalog/${entity}`)).json()) as {
      items: Array<{ slug?: string; internalName?: string }>;
    };
    const id =
      entity === "heroes" ? first.items[0]?.slug : first.items[0]?.internalName;
    if (id)
      await (await read(`/${entity}/${encodeURIComponent(id)}`)).arrayBuffer();
    await (
      await read("/api/catalog/replica", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...head, entity, locale: "zh-CN", known: [] }),
      })
    ).arrayBuffer();
  }
}
