"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "@/i18n/provider";

/** Expected availability failures stay in the page, outside the dev overlay. */
export function DataUnavailable() {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <main className="mx-auto max-w-[var(--content-max)] px-4 py-5 sm:px-6">
      <h1 className="text-xl font-semibold">{t("版本变化")}</h1>
      <p role="status" className="mt-4 text-sm text-[var(--text-secondary)]">
        {t("暂时无法加载游戏资料，请稍后刷新重试。")}
      </p>
      <button
        type="button"
        className="mt-3 rounded border px-3 py-1 text-sm disabled:opacity-50"
        disabled={pending}
        aria-busy={pending}
        onClick={() => startTransition(() => router.refresh())}
      >
        {t("重试")}
      </button>
    </main>
  );
}
