import { heroStatsAtLevel, type HeroStatCalculations } from "./hero-stats";
import type { HeroStatModifier } from "@/domain/hero-build";

export interface HeroRankingRow {
  internal_name: string;
  name: string;
  [field: string]: unknown;
}
export type RankedPoint = { id: string; name: string; value: number };
export const growingStats = new Set([
  "strength",
  "agility",
  "intelligence",
  "health",
  "mana",
  "healthRegen",
  "manaRegen",
  "damageMin",
  "damageMax",
  "armor",
  "attackSpeed",
  "magicResistance",
]);
export function rankingNumber(value: unknown): number | null {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    String(value).trim() === ""
  )
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function projectRankingHero(
  hero: HeroRankingRow,
  level: number,
  source: string | null,
  modifiers: readonly HeroStatModifier[] = [],
) {
  const current = heroStatsAtLevel(hero, level, source, modifiers);
  const from = level === 30 ? 29 : level;
  const before =
    from === level ? current : heroStatsAtLevel(hero, from, source, modifiers);
  const after = heroStatsAtLevel(hero, from + 1, source, modifiers);
  const values: Record<string, number | null> = {};
  const growth: Record<string, number | null> = {};
  for (const key of Object.keys(
    current.calculations,
  ) as (keyof HeroStatCalculations)[]) {
    values[key] = current[key];
    if (growingStats.has(key))
      growth[key] =
        after[key] === null || before[key] === null
          ? null
          : Math.round((after[key]! - before[key]!) * 1e6) / 1e6;
  }
  for (const [key, value] of Object.entries(hero))
    values[`raw:${key}`] = rankingNumber(value);
  return { id: hero.internal_name, name: hero.name, values, growth };
}

/** Competition rank. Equal values share rank; the percentile excludes equals.
 * Extremes stay P100/P0 even with ties. A wholly equal population is P50. */
export function rankHeroValue(points: RankedPoint[], current: RankedPoint) {
  const sorted = [...points.filter((point) => point.id !== current.id), current]
    .filter((point) => Number.isFinite(point.value))
    .sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const higher = sorted.filter((point) => point.value > current.value).length;
  const lower = sorted.filter((point) => point.value < current.value).length;
  const equal = sorted.length - higher - lower;
  return {
    sorted,
    rank: higher + 1,
    total: sorted.length,
    equal,
    percentile:
      higher + lower ? Math.round((lower / (higher + lower)) * 100) : 50,
    index: sorted.findIndex((point) => point.id === current.id),
  };
}
