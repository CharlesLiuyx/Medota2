/** UI locales and source-data locales have separate capabilities. */
export type GameLocale = "zh-CN" | "en";
export interface LocaleDefinition {
  name: string;
  nativeName: string;
  intl: string;
  direction: "ltr" | "rtl";
  gameLocale: GameLocale;
  fallback: string;
}
export const localeDefinitions = {
  "zh-CN": {
    name: "简体中文",
    nativeName: "简体中文",
    intl: "zh-CN",
    direction: "ltr",
    gameLocale: "zh-CN",
    fallback: "en",
  },
  en: {
    name: "英语",
    nativeName: "English",
    intl: "en",
    direction: "ltr",
    gameLocale: "en",
    fallback: "zh-CN",
  },
} as const satisfies Record<string, LocaleDefinition>;
export type Locale = keyof typeof localeDefinitions;
export const DEFAULT_LOCALE: Locale = "zh-CN";
export const LOCALES = Object.keys(localeDefinitions) as Locale[];
export function gameLocale(locale: Locale): GameLocale {
  return localeDefinitions[locale].gameLocale;
}
