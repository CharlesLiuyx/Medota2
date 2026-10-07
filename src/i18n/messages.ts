import { LOCALES, type Locale } from "./locale";
import { formatNumber } from "./format";
import english from "./en.json";
import chinese from "./zh-CN.json";
import officialTerms from "./official-terms.json";
export type MessageKey = keyof typeof english;
/** Preserve Valve wording; only remove presentation markup and label colons. */
function officialCatalog(locale: Locale): Record<string, string> {
  return Object.fromEntries(
    officialTerms.entries.flatMap((entry) => {
      const value = (entry.values as Record<string, string>)[locale];
      return value
        ? [
            [
              entry.message,
              value
                .replace(/<[^>]*>/gu, "")
                .trim()
                .replace(/[:：]$/u, "")
                .trim(),
            ],
          ]
        : [];
    }),
  );
}
/** The Chinese source messages are the stable IDs; every enabled locale has a catalog. */
export const messageCatalogs: Record<Locale, Record<string, string>> = {
  "zh-CN": {
    ...Object.fromEntries(Object.keys(english).map((key) => [key, key])),
    ...chinese,
    ...officialCatalog("zh-CN"),
  },
  en: { ...english, ...officialCatalog("en") },
} satisfies Record<Locale, Record<string, string>>;
export type MessageValues = Record<
  string,
  string | number | boolean | null | undefined
>;
export function messageTemplate(locale: Locale, source: string): string {
  return (messageCatalogs[locale] as Record<string, string>)[source] ?? source;
}
export function translate(
  locale: Locale,
  source: string,
  values: MessageValues = {},
): string {
  return messageTemplate(locale, source).replace(
    /\{([a-zA-Z][a-zA-Z0-9_]*)\}/gu,
    (token, key: string) => {
      if (!Object.hasOwn(values, key)) return token;
      const value = values[key];
      return typeof value === "number"
        ? formatNumber(locale, value)
        : String(value ?? "");
    },
  );
}
export type Translator = (source: string, values?: MessageValues) => string;
const translators = Object.fromEntries(
  LOCALES.map((locale) => [
    locale,
    (source: string, values?: MessageValues) =>
      translate(locale, source, values),
  ]),
) as Record<Locale, Translator>;
export function createTranslator(locale: Locale): Translator {
  return translators[locale];
}
