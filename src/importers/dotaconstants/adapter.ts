import type { ImportIssue } from "@/domain/heroes";

export interface ReferenceHero {
  heroId: number;
  internalName: string;
  raw: Record<string, unknown>;
}

export function parseReferenceHeroes(source: string): {
  heroes: ReferenceHero[];
  issues: ImportIssue[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(
      `build/heroes.json is not valid JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("build/heroes.json must be an object keyed by HeroID.");
  }

  const heroes: ReferenceHero[] = [];
  const issues: ImportIssue[] = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issues.push(
        blocking(
          "invalid_reference_record",
          `Reference record ${key} is not an object.`,
        ),
      );
      continue;
    }
    const raw = value as Record<string, unknown>;
    const heroId = raw.id;
    const internalName = raw.name;
    if (
      !/^[1-9]\d*$/u.test(key) ||
      !Number.isSafeInteger(heroId) ||
      heroId !== Number(key)
    ) {
      issues.push(
        blocking(
          "invalid_reference_id",
          `Reference record ${key} has an invalid or mismatched id.`,
        ),
      );
      continue;
    }
    if (
      typeof internalName !== "string" ||
      !/^npc_dota_hero_[a-z0-9_]+$/u.test(internalName)
    ) {
      issues.push(
        blocking(
          "invalid_reference_name",
          `Reference record ${key} has an invalid name.`,
        ),
      );
      continue;
    }
    heroes.push({ heroId, internalName, raw });
  }
  heroes.sort((a, b) => a.heroId - b.heroId);
  if (issues.length > 0) {
    const error = new Error(
      `dotaconstants has ${issues.length} blocking reference record error(s).`,
    );
    Object.assign(error, { issues });
    throw error;
  }
  return { heroes, issues };
}

function blocking(code: string, message: string): ImportIssue {
  return { severity: "blocking", code, message };
}
