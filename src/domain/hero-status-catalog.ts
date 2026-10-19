import type { HeroStatusDefinition } from "./hero-inventory";

export type StatusProviderKind =
  "item" | "hero" | "neutral" | "building" | "unit";
export interface StatusProvider {
  id: string;
  kind: StatusProviderKind;
  name: string;
  enName: string;
  href: string;
}
export interface HeroStatusCatalog {
  dataset: string;
  sourceCommit: string;
  abilityImageVersion: string;
  statuses: HeroStatusDefinition[];
  provenance: object;
}
export const normalizeStatusSearch = (value: string) =>
  value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_'’\-]+/gu, "");

export function statusAtLevel(
  status: HeroStatusDefinition,
  level = 1,
): HeroStatusDefinition {
  const selected = status.levels?.[level - 1];
  return selected
    ? {
        ...status,
        effects: selected.effects,
        duration: selected.duration,
        selectedLevel: level,
      }
    : status;
}
export function groupStatusResults(
  statuses: HeroStatusDefinition[],
  query: string,
  kind: StatusProviderKind | "all",
) {
  const terms = query
    .trim()
    .split(/\s+/u)
    .map(normalizeStatusSearch)
    .filter(Boolean);
  const groups = new Map<
    string,
    { provider: StatusProvider; statuses: HeroStatusDefinition[] }
  >();
  for (const status of statuses) {
    const provider = status.provider;
    if (!provider || (kind !== "all" && provider.kind !== kind)) continue;
    const haystack =
      status.searchText ??
      normalizeStatusSearch(
        [
          status.name,
          status.enName,
          provider.name,
          provider.enName,
          status.sourceModifier,
          status.sourceAbility?.name,
          status.sourceAbility?.enName,
        ].join(" "),
      );
    if (!terms.every((term) => haystack.includes(term))) continue;
    const group = groups.get(provider.id) ?? { provider, statuses: [] };
    group.statuses.push(status);
    groups.set(provider.id, group);
  }
  return [...groups.values()];
}
