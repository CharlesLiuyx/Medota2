import { pinyin } from "pinyin-pro";

export interface SearchEntry {
  id: string;
  names: readonly string[];
  aliases?: readonly string[];
  // Owner words permit queries such as “敌法 闪烁” / “am blink”.
  context?: readonly string[];
}
import {
  normalizeSearch,
  searchDocuments,
  type SearchTerms,
  type SearchDocument,
} from "./query";
export { normalizeSearch } from "./query";

// Build once per immutable catalog; pinyin never runs in the keystroke loop.
export function createSearchIndex(entries: readonly SearchEntry[]) {
  const vocabulary = new Map<string, { text: string[]; initial?: string }>();
  function terms(values: readonly string[]): SearchTerms {
    const text = new Set<string>();
    const shortcuts = new Set<string>();
    for (const value of values) {
      if (!value) continue;
      let term = vocabulary.get(value);
      if (!term) {
        term = { text: [normalizeSearch(value)] };
        if (/\p{Script=Han}/u.test(value)) {
          const syllables = pinyin(value, {
            toneType: "none",
            type: "array",
            v: true,
          });
          term.text.push(normalizeSearch(syllables.join("")));
          term.initial = normalizeSearch(
            syllables.map((part) => part[0]).join(""),
          );
        }
        vocabulary.set(value, term);
      }
      for (const word of term.text) text.add(word);
      if (term.initial) shortcuts.add(term.initial);
      if (/^[a-z]{1,4}$/u.test(term.text[0])) shortcuts.add(term.text[0]);
    }
    return { text: [...text].sort(), shortcuts: [...shortcuts].sort() };
  }
  const documents: SearchDocument[] = entries.map((entry) => ({
    id: entry.id,
    ...terms([...entry.names, ...(entry.aliases ?? [])]),
    context: terms(entry.context ?? []),
  }));
  return {
    size: documents.length,
    documents,
    search: (query: string) => searchDocuments(documents, query),
  };
}
