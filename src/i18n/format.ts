import { localeDefinitions } from "./config";
import type { Locale } from "./locale";
export const DISPLAY_TIME_ZONE = "Asia/Singapore";
const numberFormats = new Map<string, Intl.NumberFormat>();
export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
) {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let formatter = numberFormats.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(localeDefinitions[locale].intl, options);
    numberFormats.set(key, formatter);
  }
  return formatter.format(value);
}
export function formatDateTime(
  locale: Locale,
  value: Date | string,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(localeDefinitions[locale].intl, {
    timeZone: DISPLAY_TIME_ZONE,
    ...options,
  }).format(new Date(value));
}
