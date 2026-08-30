import {
  ATTACK_TYPES,
  HERO_ROLES,
  PRIMARY_ATTRIBUTES,
  type AttackType,
  type HeroRole,
  type PrimaryAttribute,
} from "@/domain/heroes";

export type SearchParams = Record<string, string | string[] | undefined>;

export interface HeroFilters {
  q: string;
  attributes: PrimaryAttribute[];
  roles: HeroRole[];
  attacks: AttackType[];
  cm: "all" | "true" | "false";
  lang: "zh-CN" | "en";
}

export interface ParsedHeroFilters {
  filters: HeroFilters;
  errors: string[];
}

const allowedKeys = new Set(["q", "attribute", "role", "attack", "cm", "lang"]);

export function parseHeroFilters(params: SearchParams): ParsedHeroFilters {
  const errors: string[] = [];
  for (const key of Object.keys(params)) {
    if (!allowedKeys.has(key)) errors.push(`未知查询参数：${key}`);
  }

  const rawQ = singleValue(params.q, "q", errors) ?? "";
  const q = rawQ.normalize("NFKC").trim().toLowerCase();
  if ([...q].length > 100) errors.push("搜索词最多允许 100 个 Unicode 字符。");

  const attributes = enumValues(
    params.attribute,
    PRIMARY_ATTRIBUTES,
    "主属性",
    errors,
  );
  const roles = enumValues(params.role, HERO_ROLES, "角色", errors);
  const attacks = enumValues(params.attack, ATTACK_TYPES, "攻击类型", errors);
  const cmValue = singleValue(params.cm, "cm", errors) ?? "all";
  const cm = ["all", "true", "false"].includes(cmValue)
    ? (cmValue as HeroFilters["cm"])
    : "all";
  if (cm !== cmValue) errors.push(`未知 CM 状态：${cmValue}`);
  const langValue = singleValue(params.lang, "lang", errors) ?? "zh-CN";
  const lang =
    langValue === "en" || langValue === "zh-CN" ? langValue : "zh-CN";
  if (lang !== langValue) errors.push(`未知语言：${langValue}`);

  return {
    filters: {
      q: [...q].slice(0, 100).join(""),
      attributes,
      roles,
      attacks,
      cm,
      lang,
    },
    errors,
  };
}

export function canonicalHeroQuery(filters: HeroFilters): string {
  const query = new URLSearchParams();
  if (filters.q) query.set("q", filters.q);
  for (const value of filters.attributes) query.append("attribute", value);
  for (const value of filters.roles) query.append("role", value);
  for (const value of filters.attacks) query.append("attack", value);
  if (filters.cm !== "all") query.set("cm", filters.cm);
  if (filters.lang !== "zh-CN") query.set("lang", filters.lang);
  return query.toString();
}

export function isCanonicalHeroQuery(
  params: SearchParams,
  filters: HeroFilters,
): boolean {
  const expected = new URLSearchParams(canonicalHeroQuery(filters));
  for (const key of allowedKeys) {
    const raw = params[key];
    const actualValues =
      raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    if (actualValues.join("\0") !== expected.getAll(key).join("\0"))
      return false;
  }
  return true;
}

function enumValues<T extends string>(
  input: string | string[] | undefined,
  allowed: readonly T[],
  label: string,
  errors: string[],
): T[] {
  const values =
    input === undefined ? [] : Array.isArray(input) ? input : [input];
  const unique = [...new Set(values)].sort(byteSort);
  const invalid = unique.filter((value) => !allowed.includes(value as T));
  if (invalid.length) errors.push(`未知${label}：${invalid.join("、")}`);
  return unique.filter((value): value is T => allowed.includes(value as T));
}

function singleValue(
  input: string | string[] | undefined,
  key: string,
  errors: string[],
): string | undefined {
  if (Array.isArray(input)) {
    errors.push(`${key} 只允许一个值。`);
    return input[0];
  }
  return input;
}

function byteSort(left: string, right: string): number {
  return Buffer.from(left, "utf8").compare(Buffer.from(right, "utf8"));
}
