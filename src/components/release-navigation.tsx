"use client";
import { releaseLabel } from "@/presentation/releases";
import { Message, useLocale, useTranslations } from "@/i18n/provider";

import Link from "next/link";

import { withLocale, isLocale } from "@/i18n/locale";
import {
  createContext,
  useContext,
  useTransition,
  type ComponentProps,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReleaseIndex } from "@/domain/releases";
import { canonicalReleaseId, withRelease } from "@/domain/releases";
import { CompactSelect } from "./ui/compact-select";
const ReleaseContext = createContext<string | null>(null);
export function ReleaseNavigation({
  index,
  children,
}: {
  index: ReleaseIndex;
  children: ReactNode;
}) {
  const params = useSearchParams();
  return (
    <ReleaseContext
      value={
        params.get("release")
          ? canonicalReleaseId(index, params.get("release")!)
          : index.defaultRelease
      }
    >
      {children}
    </ReleaseContext>
  );
}
export function useRelease() {
  return useContext(ReleaseContext);
}
export function VersionLink({ href, ...props }: ComponentProps<typeof Link>) {
  const release = useRelease();
  const locale = useLocale();
  const objectQuery =
    typeof href === "string"
      ? {}
      : typeof href.query === "string"
        ? Object.fromEntries(new URLSearchParams(href.query))
        : (href.query ?? {});
  return (
    <Link
      {...props}
      href={
        typeof href === "string"
          ? withLocale(withRelease(href, release), locale)
          : href.pathname?.startsWith("/") &&
              !href.pathname.startsWith("//") &&
              !href.pathname.startsWith("/api/") &&
              !href.host &&
              !href.protocol
            ? {
                ...href,
                query: {
                  ...(release ? { release } : {}),
                  ...objectQuery,
                  lang: isLocale(objectQuery.lang) ? objectQuery.lang : locale,
                },
              }
            : href
      }
    />
  );
}
export function ReleaseSwitcher({ index }: { index: ReleaseIndex }) {
  const t = useTranslations();
  const locale = useLocale();
  const selected = useRelease();
  const router = useRouter(),
    pathname = usePathname(),
    params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const options = index.releases;
  if (!index.releases.length)
    return (
      <span className="text-[10px] text-[var(--text-muted)]">
        {t("版本未收录")}
      </span>
    );
  return (
    <div className="shrink-0" aria-busy={pending}>
      <CompactSelect
        label={t("全局版本")}
        hideLabel
        className="release-select"
        value={selected ?? ""}
        disabled={pending}
        onValueChange={(value) => {
          const query = new URLSearchParams(params.toString());
          query.set("release", value);
          query.set("lang", locale);
          query.delete("version");
          startTransition(() => router.push(`${pathname}?${query}`));
        }}
      >
        {!index.releases.some((r) => r.id === selected) && (
          <option value={selected ?? ""} disabled>
            {t("版本无效")}
          </option>
        )}
        {options.map((r) => (
          <option key={r.id} value={r.id}>
            {releaseLabel(r, locale)}
          </option>
        ))}
      </CompactSelect>
    </div>
  );
}
export function MissingReleaseCoverage({
  kind,
  reason,
}: {
  kind: string;
  reason?: string | null;
}) {
  const t = useTranslations();
  return (
    <main className="mx-auto min-h-[70vh] max-w-[var(--content-max)] px-4 py-16">
      <h1 className="text-xl">
        <Message
          id="该版本的{value0}资料未收录"
          values={{
            value0: kind,
          }}
        />
      </h1>
      <p role="status" className="mt-3 text-sm text-[var(--text-muted)]">
        {reason ? t(reason) : t("请在顶栏选择覆盖这类资料的版本。")}
      </p>
    </main>
  );
}
