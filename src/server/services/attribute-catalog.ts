import { createHash } from "node:crypto";
import type { AttributeSummary } from "@/domain/attributes";
import type { ListSlice } from "@/domain/infinite-list";
import { ListCursorError, ListRequestError } from "./catalog-cursor";
export interface AttributeQuery {
  q: string;
  scope: "common" | "all";
}
export function parseAttributeQuery(params: URLSearchParams): AttributeQuery {
  const q = params.get("q") ?? "",
    scope = params.get("scope") ?? "common";
  if (
    q.length > 100 ||
    !["common", "all"].includes(scope) ||
    ["q", "scope", "release", "after", "before"].some(
      (key) => params.getAll(key).length > 1,
    )
  )
    throw new ListRequestError("Invalid attribute query");
  return { q, scope: scope as AttributeQuery["scope"] };
}
export const normalizeAttributeSearch = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_'’\-]+/gu, "");
export function attributeSlice(
  entries: AttributeSummary[],
  dataset: string,
  query: AttributeQuery,
  cursors: { after?: string; before?: string } = {},
): ListSlice<Omit<AttributeSummary, "searchText">> {
  if (cursors.after !== undefined && cursors.before !== undefined)
    throw new ListRequestError("Only one cursor is allowed");
  const identity = createHash("sha256")
    .update(JSON.stringify(["attributes-v2", dataset, query]))
    .digest("hex");
  const selected = entries.filter(
    (e) =>
      (query.scope === "all" || !e.id.includes("~")) &&
      normalizeAttributeSearch(e.searchText).includes(
        normalizeAttributeSearch(query.q),
      ),
  );
  const encoded = cursors.after ?? cursors.before;
  let offset = 0;
  if (encoded !== undefined) {
    if (encoded.length > 200)
      throw new ListCursorError("invalid_cursor", "Invalid attribute cursor");
    const [hash, index, ...rest] = encoded.split(":");
    if (hash !== identity)
      throw new ListCursorError(
        "stream_mismatch",
        "Attribute cursor belongs to another query or version",
      );
    if (rest.length || !/^\d+$/.test(index ?? ""))
      throw new ListCursorError("invalid_cursor", "Invalid attribute cursor");
    offset = Number(index);
    if (!Number.isSafeInteger(offset) || offset > selected.length)
      throw new ListCursorError("invalid_cursor", "Invalid attribute cursor");
  }
  // The three primary attributes occupy their own group. Keep 48 ordinary
  // cards per chunk so boundaries align at every supported 2/3/4-column width.
  const firstPageSize =
    48 +
    selected.filter((entry) =>
      ["strength", "agility", "intelligence"].includes(entry.id),
    ).length;
  const start =
    cursors.before !== undefined
      ? offset <= firstPageSize
        ? 0
        : offset - 48
      : offset;
  const end =
    cursors.before !== undefined
      ? offset
      : Math.min(selected.length, start + (start === 0 ? firstPageSize : 48));
  return {
    items: selected.slice(start, end).map((entry) => ({
      id: entry.id,
      zh: entry.zh,
      en: entry.en,
      summary: entry.summary,
      count: entry.count,
      owner: entry.owner,
      kinds: entry.kinds,
    })),
    datasetVersionId: dataset,
    total: selected.length,
    previousCursor: start > 0 ? `${identity}:${start}` : null,
    nextCursor: end < selected.length ? `${identity}:${end}` : null,
  };
}
