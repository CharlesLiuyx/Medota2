"use client";
import { gameLocale, localeDefinitions, LOCALES } from "./config";
import {
  createContext,
  useContext,
  useEffect,
  useTransition,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CompactSelect } from "@/components/ui/compact-select";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  resolveLocale,
  type Locale,
} from "./locale";
import { createTranslator, messageTemplate } from "./messages";
import { formatNumber } from "./format";
import { Fragment } from "react";
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const params = useSearchParams();
  const locale = resolveLocale(params.get("lang"), initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDefinitions[locale].direction;
    document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [locale]);
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}
export function useLocale() {
  return useContext(LocaleContext);
}
export function useGameLocale() {
  return gameLocale(useLocale());
}
export function useTranslations() {
  const locale = useLocale();
  return createTranslator(locale);
}
export function LocalizedText({ children }: { children: string }) {
  const t = useTranslations();
  return t(children);
}
export function LanguageSwitcher() {
  const locale = useLocale(),
    t = useTranslations();
  const router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  const [pending, startTransition] = useTransition();
  return (
    <div className="shrink-0" aria-busy={pending}>
      <CompactSelect
        label={t("语言")}
        hideLabel
        className="language-select"
        value={locale}
        disabled={pending}
        onValueChange={(value) => {
          const next = resolveLocale(value);
          const query = new URLSearchParams(params.toString());
          query.set("lang", next);
          document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
          startTransition(() =>
            router.push(`${pathname}?${query}${window.location.hash}`, {
              scroll: false,
            }),
          );
        }}
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {localeDefinitions[code].nativeName}
          </option>
        ))}
      </CompactSelect>
    </div>
  );
}

/** Rich messages retain React nodes and allow each language to order complete sentences. */
export function Message({
  id,
  values = {},
}: {
  id: string;
  values?: Record<string, ReactNode>;
}) {
  const locale = useLocale();
  const pieces = messageTemplate(locale, id).split(
    /(\{[a-zA-Z][a-zA-Z0-9_]*\})/gu,
  );
  return pieces.map((part, i) => {
    const key = part.startsWith("{") ? part.slice(1, -1) : null;
    const value = key && Object.hasOwn(values, key) ? values[key] : part;
    return (
      <Fragment key={i}>
        {typeof value === "number" ? formatNumber(locale, value) : value}
      </Fragment>
    );
  });
}

/** Show the actual language when versioned source content uses a fallback. */
export function SourceLanguageNotice({
  sourceLocale,
  partial = false,
}: {
  sourceLocale?: string | null;
  partial?: boolean;
}) {
  const locale = useLocale(),
    t = useTranslations();
  if (!sourceLocale || sourceLocale === locale) return null;
  const name =
    sourceLocale === "en"
      ? t("英文")
      : sourceLocale === "zh-CN"
        ? t("中文")
        : sourceLocale;
  return (
    <span className="text-[10px] text-[var(--text-muted)]">
      {t(partial ? "部分资料原文：{language}" : "原文：{language}", {
        language: name,
      })}
    </span>
  );
}

/** Keep source prose and its actual language together at the display boundary. */
export function SourceText({
  sourceLocale,
  children,
}: {
  sourceLocale?: string | null;
  children: ReactNode;
}) {
  return (
    <>
      <span lang={sourceLocale || undefined} data-source-text="">
        {children}
      </span>{" "}
      <SourceLanguageNotice sourceLocale={sourceLocale} />
    </>
  );
}
