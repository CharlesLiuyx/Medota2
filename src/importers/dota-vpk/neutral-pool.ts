import type { KeyValuesObject } from "@/importers/keyvalues/parser";

export interface NeutralTierPool {
  tier: number;
  items: Map<string, number>;
  enchantments: Map<string, number>;
}
const child = (root: KeyValuesObject | undefined, key: string) => {
  const entry = root?.entries.findLast((e) => e.key === key)?.value;
  return typeof entry === "object" ? entry : undefined;
};
/** Tier membership and enhancement level are independent source facts. */
export function neutralPool(
  raw: KeyValuesObject | null | undefined,
  primary: string,
): NeutralTierPool[] {
  const tiers = child(
    child(raw ?? undefined, "neutral_items"),
    "neutral_tiers",
  );
  if (!tiers) return [];
  const entries = (root: KeyValuesObject | undefined) => {
    const result = new Map<string, number>();
    for (const entry of root?.entries ?? []) {
      if (typeof entry.value !== "string" || !/^[1-9]\d*$/.test(entry.value))
        throw new Error(`Invalid neutral pool entry: ${entry.key}`);
      if (result.has(entry.key))
        throw new Error(`Duplicate neutral item: ${entry.key}`);
      result.set(entry.key, Number(entry.value));
    }
    return result;
  };
  const seen = new Set<number>();
  return tiers.entries
    .map((entry) => {
      const tier = Number(entry.key);
      if (
        !Number.isInteger(tier) ||
        tier < 1 ||
        tier > 5 ||
        typeof entry.value !== "object" ||
        seen.has(tier)
      )
        throw new Error(`Invalid neutral tier: ${entry.key}`);
      seen.add(tier);
      const enhancements = child(entry.value, "enhancements");
      const enchantments = entries(child(enhancements, "global"));
      for (const [id, level] of entries(child(enhancements, primary))) {
        if (enchantments.has(id) && enchantments.get(id) !== level)
          throw new Error(`Conflicting enhancement level: ${id}`);
        enchantments.set(id, level);
      }
      return {
        tier,
        items: entries(child(entry.value, "items")),
        enchantments,
      };
    })
    .sort((a, b) => a.tier - b.tier);
}
