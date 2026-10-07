import { localeDefinitions, DEFAULT_LOCALE, type Locale } from "./config";
export { LOCALES, DEFAULT_LOCALE, type Locale } from "./config";
export const LOCALE_COOKIE = "medota2-locale";
export const LOCALE_HEADER = "x-medota2-locale";
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && Object.hasOwn(localeDefinitions, value);
}
export function resolveLocale(value: unknown, preference?: unknown): Locale {
  return isLocale(value)
    ? value
    : isLocale(preference)
      ? preference
      : DEFAULT_LOCALE;
}
/** Only app-relative navigation inherits language; external URLs and anchors do not. */
export function withLocale(
  href: string,
  locale: Locale,
  force = false,
): string {
  if (
    !href.startsWith("/") ||
    href.startsWith("//") ||
    href.startsWith("/api/") ||
    href.startsWith("/map/assets/") ||
    href.startsWith("/valve-assets/")
  )
    return href;
  const url = new URL(href, "http://medota2.local");
  if (/\.[a-z0-9]+$/iu.test(url.pathname)) return href;
  if (force || !isLocale(url.searchParams.get("lang")))
    url.searchParams.set("lang", locale);
  return `${url.pathname}${url.search}${url.hash}`;
}
