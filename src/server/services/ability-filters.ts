import {
  ABILITY_CATALOG_STATUSES,
  ABILITY_RELATION_KINDS,
} from "@/domain/abilities";
import type { SearchParams } from "./hero-filters";

export type AbilityStatusFilter =
  (typeof ABILITY_CATALOG_STATUSES)[number] | "all";

export interface AbilityFilters {
  q: string;
  status: AbilityStatusFilter;
  hero: string;
  relation: (typeof ABILITY_RELATION_KINDS)[number] | "all";
  behavior: string;
  damage: string;
  upgrade: "all" | "scepter" | "shard" | "granted";
  lang: "zh-CN" | "en";
}

export function parseAbilityFilters(params: SearchParams): {
  filters: AbilityFilters;
  errors: string[];
} {
  const errors: string[] = [];
  const allowed = new Set([
    "q",
    "status",
    "hero",
    "relation",
    "behavior",
    "damage",
    "upgrade",
    "lang",
    "page",
  ]);
  for (const key of Object.keys(params)) {
    if (!allowed.has(key)) errors.push(`未知查询参数：${key}`);
  }
  const read = (key: keyof AbilityFilters, fallback = "") => {
    const raw = params[key];
    if (Array.isArray(raw)) {
      errors.push(`${key} 只允许一个值。`);
      return raw[0] ?? fallback;
    }
    return raw ?? fallback;
  };
  const q = read("q").normalize("NFKC").trim().toLowerCase();
  if ([...q].length > 100) errors.push("搜索词最多允许 100 个字符。");
  const rawStatus = read("status", "current");
  const status = ([...ABILITY_CATALOG_STATUSES, "all"] as string[]).includes(
    rawStatus,
  )
    ? (rawStatus as AbilityStatusFilter)
    : "current";
  if (status !== rawStatus) errors.push(`未知 Ability 状态：${rawStatus}`);
  const rawRelation = read("relation", "all");
  const relation = ([...ABILITY_RELATION_KINDS, "all"] as string[]).includes(
    rawRelation,
  )
    ? (rawRelation as AbilityFilters["relation"])
    : "all";
  if (relation !== rawRelation) errors.push(`未知关系类型：${rawRelation}`);
  const hero = safeIdentifier(read("hero"), "Hero", errors);
  const behavior = safeEnum(read("behavior"), "Behavior", errors);
  const damage = safeEnum(read("damage"), "Damage type", errors);
  const rawUpgrade = read("upgrade", "all");
  const upgrade = ["all", "scepter", "shard", "granted"].includes(rawUpgrade)
    ? (rawUpgrade as AbilityFilters["upgrade"])
    : "all";
  if (upgrade !== rawUpgrade) errors.push(`未知升级类型：${rawUpgrade}`);
  const rawLang = read("lang", "zh-CN");
  const lang = rawLang === "en" || rawLang === "zh-CN" ? rawLang : "zh-CN";
  if (lang !== rawLang) errors.push(`未知语言：${rawLang}`);
  const rawPage = readLegacyPage(params.page, errors);
  if (
    rawPage !== undefined &&
    (!/^\d+$/u.test(rawPage) ||
      !Number.isSafeInteger(Number(rawPage)) ||
      Number(rawPage) < 1 ||
      Number(rawPage) > 10_000 ||
      String(Number(rawPage)) !== rawPage)
  ) {
    errors.push(`无效页码：${rawPage}`);
  }
  return {
    filters: {
      q: [...q].slice(0, 100).join(""),
      status,
      hero,
      relation,
      behavior,
      damage,
      upgrade,
      lang,
    },
    errors,
  };
}

export function canonicalAbilityQuery(filters: AbilityFilters): string {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  if (filters.status !== "current") query.set("status", filters.status);
  if (filters.hero) query.set("hero", filters.hero);
  if (filters.relation !== "all") query.set("relation", filters.relation);
  if (filters.behavior) query.set("behavior", filters.behavior);
  if (filters.damage) query.set("damage", filters.damage);
  if (filters.upgrade !== "all") query.set("upgrade", filters.upgrade);
  if (filters.lang !== "zh-CN") query.set("lang", filters.lang);
  return query.toString();
}

export function isCanonicalAbilityQuery(
  params: SearchParams,
  filters: AbilityFilters,
): boolean {
  return (
    new URLSearchParams(canonicalAbilityQuery(filters)).toString() ===
    new URLSearchParams(
      Object.entries(params).flatMap(([key, value]) =>
        value === undefined
          ? []
          : (Array.isArray(value) ? value : [value]).map(
              (item) => [key, item] as [string, string],
            ),
      ),
    ).toString()
  );
}

function safeIdentifier(
  value: string,
  label: string,
  errors: string[],
): string {
  if (value && !/^[a-z0-9_]+$/u.test(value)) {
    errors.push(`${label} 标识符无效：${value}`);
    return "";
  }
  return value;
}

function safeEnum(value: string, label: string, errors: string[]): string {
  if (value && !/^[A-Z0-9_]+$/u.test(value)) {
    errors.push(`${label} 无效：${value}`);
    return "";
  }
  return value;
}

function readLegacyPage(
  value: SearchParams[string],
  errors: string[],
): string | undefined {
  if (Array.isArray(value)) {
    errors.push("page 只允许一个值。");
    return value[0];
  }
  return value;
}
