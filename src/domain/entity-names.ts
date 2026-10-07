import supplement from "@/data/entity-names/supplement.v1.json";

export type NamedEntity = "ability" | "facet" | "item" | "unit";
export type NameOrigin =
  "localized" | "historical" | "alias" | "derived" | "descriptive";
interface SupplementalName {
  entity: NamedEntity;
  key: string;
  names: { zh: string; en: string };
  kind: NameOrigin;
}
const reviewedNames = supplement.entries as SupplementalName[];
const commits = new Set(supplement.appliesToSourceCommits);

/** Supplements are reviewed for these exact source identities, never future heads. */
export function nameSupplementProvenance(sourceCommit: string) {
  return commits.has(sourceCommit)
    ? { id: supplement.id, content_sha256: supplement.contentSha256 }
    : null;
}

/** Fill names only. Historical labels cannot supply current gameplay or values. */
export function supplementEntityNames(
  tokens: Record<string, string>,
  sourceCommit: string,
  locale: string,
): Record<string, string> {
  if (!commits.has(sourceCommit)) return tokens;
  const result = { ...tokens };
  const english = locale === "en";
  for (const entry of reviewedNames) {
    const token =
      entry.entity === "unit"
        ? entry.key
        : `dota_tooltip_${entry.entity === "facet" ? "facet" : "ability"}_${entry.key}`;
    // A format string without its engine argument is not a usable unit name.
    if (
      result[token] &&
      !(entry.entity === "unit" && /%|\{.*\}/u.test(result[token]))
    )
      continue;
    const marker =
      entry.kind === "descriptive"
        ? english
          ? " (descriptive)"
          : "（用途名）"
        : "";
    result[token] = (english ? entry.names.en : entry.names.zh) + marker;
  }
  return result;
}
