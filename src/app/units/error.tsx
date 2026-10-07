"use client";
import { useTranslations } from "@/i18n/provider";
export default function UnitError({ reset }: { reset: () => void }) {
  const t = useTranslations();
  return (
    <main className="mx-auto min-h-[60vh] max-w-[var(--content-max)] px-4 py-12">
      <h1 className="text-xl">{t("单位资料读取失败")}</h1>
      <p className="mt-3 text-sm text-[var(--text-muted)]">
        {t("请检查当前版本的数据来源，或稍后重试。")}
      </p>
      <button onClick={reset} className="mt-4 bg-white/5 px-3 py-2 text-xs">
        {t("重新读取")}
      </button>
    </main>
  );
}
