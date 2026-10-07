/** A release is a read context. Dataset IDs and client builds remain independent. */
export interface ReleaseOption {
  id: string;
  patch: string | null;
  label: string;
  catalogId: string | null;
  mapId: string | null;
  catalogClient: string | null;
  mapClient: string | null;
  sourceCommit: string | null;
  mapReason: string | null;
}
export interface ReleaseIndex {
  defaultRelease: string | null;
  releases: ReleaseOption[];
  aliases?: Record<string, string>;
}
export function withRelease(href: string, release: string | null): string {
  if (
    !release ||
    !/^\/(heroes|abilities|units|items|attributes|map|changes)(\/|\?|#|$)/u.test(
      href,
    )
  )
    return href;
  const url = new URL(href, "https://medota2.invalid");
  if (!url.searchParams.has("release"))
    url.searchParams.set("release", release);
  return `${url.pathname}${url.search}${url.hash}`;
}
export function readReleaseParameter(
  value: string | string[] | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (
    Array.isArray(value) ||
    !/^(c:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|m:[a-zA-Z0-9][a-zA-Z0-9._-]{0,95})$/u.test(
      value,
    )
  )
    throw new Error("版本参数无效，只允许一个已收录版本。");
  return value;
}

export function canonicalReleaseId(index: ReleaseIndex, id: string): string {
  return index.aliases?.[id] ?? id;
}
