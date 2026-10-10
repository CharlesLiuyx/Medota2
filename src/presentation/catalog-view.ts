/** Presentation state stays out of data queries, replicas and cursor identity. */
export const CATALOG_PRESENTATION_KEYS = ["view", "sort", "order"] as const;
export function withCatalogPresentation(
  href: string,
  state: Record<string, string | string[] | null | undefined>,
): string {
  const url = new URL(href, "http://medota2.local");
  for (const key of CATALOG_PRESENTATION_KEYS) {
    const value = state[key];
    if (
      typeof value === "string" &&
      value &&
      (key !== "view" || value === "table")
    )
      url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
