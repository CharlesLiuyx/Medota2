export interface SearchTerms {
  text: string[];
  shortcuts: string[];
}
export interface SearchDocument extends SearchTerms {
  id: string;
  context: SearchTerms;
}

export function normalizeSearch(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/u\u0308/gu, "v")
    .replace(/\p{M}/gu, "")
    .replace(/[\s_'’\-]+/gu, "");
}

function match(terms: SearchTerms, word: string) {
  return (
    terms.shortcuts.includes(word) ||
    terms.text.some((value) => value.includes(word))
  );
}

/** Runs over precomputed terms; no pinyin library is shipped to the browser. */
export function searchDocuments(
  documents: readonly SearchDocument[],
  query: string,
): string[] {
  const trimmed = query.normalize("NFKC").trim();
  if (!trimmed) return documents.map((doc) => doc.id);
  const joined = normalizeSearch(trimmed);
  const words = trimmed.split(/\s+/u).map(normalizeSearch).filter(Boolean);
  if (!joined || !words.length) return [];
  // Exact short aliases / initials win over accidental substrings: AM ≠ shaman.
  if (/^[a-z]{1,3}$/u.test(joined)) {
    const exact = documents.filter((doc) => doc.shortcuts.includes(joined));
    if (exact.length) return exact.map((doc) => doc.id);
  }
  const direct = documents.filter(
    (doc) =>
      match(doc, joined) ||
      (words.length > 1 &&
        words.some((word) => match(doc, word)) &&
        words.every((word) => match(doc, word) || match(doc.context, word))),
  );
  if (direct.length) return direct.map((doc) => doc.id);
  // A hero-only query can still find that hero's abilities; owner matches
  // never drown out a direct ability-name or alias match.
  return documents
    .filter(
      (doc) =>
        match(doc.context, joined) ||
        words.every((word) => match(doc.context, word)),
    )
    .map((doc) => doc.id);
}
