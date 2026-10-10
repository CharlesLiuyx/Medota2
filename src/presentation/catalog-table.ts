import type { Locale } from "@/i18n/locale";

export type CatalogSortValue = string | number | readonly number[] | null;

/** Only parse complete numeric level lists; conditional prose stays text. */
export function catalogNumericValue(value: string | null): CatalogSortValue {
  if (value === null || !value.trim()) return null;
  const parts = value.trim().split(/\s*\/\s*|\s+/u);
  if (parts.every((part) => /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?$/u.test(part))) {
    const values = parts.map((part) => Number(part.replace(/%$/u, "")));
    return values.every(Number.isFinite) ? values : value;
  }
  return value;
}

/** Nulls remain last in both directions; ties keep the original catalog order. */
export function compareCatalogValues(
  a: CatalogSortValue,
  b: CatalogSortValue,
  direction: "asc" | "desc",
  collator: Intl.Collator,
): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const left = typeof a === "number" ? [a] : a;
  const right = typeof b === "number" ? [b] : b;
  let result = 0;
  if (typeof left !== "string" && typeof right !== "string") {
    for (let index = 0; index < Math.min(left.length, right.length); index++) {
      result = left[index] - right[index];
      if (result) break;
    }
    result ||= left.length - right.length;
  } else {
    result = collator.compare(String(a), String(b));
  }
  return direction === "asc" ? result : -result;
}

export function sortCatalogRows<T>(
  rows: readonly T[],
  value: (row: T) => CatalogSortValue,
  direction: "asc" | "desc",
  locale: Locale,
): T[] {
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  return [...rows].sort((a, b) =>
    compareCatalogValues(value(a), value(b), direction, collator),
  );
}

const decimalFormats = new Map<number, Intl.NumberFormat>();
/** Automatic precision trims source padding; explicit precision rounds for display only. */
export function formatCatalogNumberText(
  value: string,
  decimals?: number,
): string {
  if (typeof catalogNumericValue(value) === "string") return value;
  return value.replace(
    /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(%?)/gu,
    (token, percent: string) => {
      const raw = percent ? token.slice(0, -1) : token;
      const number = Number(raw);
      if (!Number.isFinite(number)) return token;
      if (decimals === undefined) {
        const trimmed = raw.includes(".")
          ? raw.replace(/(\.\d*?)0+$/u, "$1").replace(/\.$/u, "")
          : raw;
        const normalized = trimmed.replace(
          /^([+-]?)\./u,
          (_, sign: string) => `${sign}0.`,
        );
        return `${normalized === "" || normalized === "-" || normalized === "-0" ? "0" : normalized === "+" ? "+0" : normalized}${percent}`;
      }
      let format = decimalFormats.get(decimals);
      if (!format) {
        format = new Intl.NumberFormat("en", {
          useGrouping: false,
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
        decimalFormats.set(decimals, format);
      }
      return `${token.startsWith("+") && number >= 0 ? "+" : ""}${format.format(number)}${percent}`;
    },
  );
}
