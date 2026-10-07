import { posix } from "node:path";
import type { CheckedSourceFile } from "@/importers/git-checkout";
import {
  objectEntries,
  parseKeyValues,
  uniqueObject,
  type KeyValuesObject,
} from "@/importers/keyvalues/parser";

export const HEROES_PATH = "scripts/npc/npc_heroes.txt";

// Resolve only the fixed, checked selector. Never read an include from disk.
export function readHeroSource(files: readonly CheckedSourceFile[]): {
  root: KeyValuesObject;
  origins: Map<string, CheckedSourceFile>;
} {
  const selected = new Map(files.map((file) => [file.path, file]));
  const origins = new Map<string, CheckedSourceFile>();
  const root: KeyValuesObject = { entries: [] };
  const visited = new Set<string>();
  function visit(path: string): void {
    if (visited.has(path))
      throw new Error(`Duplicate or cyclic hero #base: ${path}`);
    visited.add(path);
    const file = selected.get(path);
    if (!file)
      throw new Error(`Hero #base is outside checked selector: ${path}`);
    const document = parseKeyValues(file.text);
    for (const include of objectEntries(document, "#base")) {
      if (
        typeof include.value !== "string" ||
        !/^heroes\/npc_dota_hero_[a-z0-9_]+\.txt$/u.test(include.value) ||
        path !== HEROES_PATH
      ) {
        throw new Error(`Unsupported hero #base in ${path}`);
      }
      visit(posix.join(posix.dirname(path), include.value));
    }
    const heroes = uniqueObject(document, "DOTAHeroes");
    for (const entry of heroes.entries) {
      if (entry.key === "Version") continue;
      if (origins.has(entry.key))
        throw new Error(`Duplicate hero definition: ${entry.key}`);
      origins.set(entry.key, file);
      root.entries.push(entry);
    }
  }
  visit(HEROES_PATH);
  return { root, origins };
}
