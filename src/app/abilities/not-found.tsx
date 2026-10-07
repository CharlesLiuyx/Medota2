import { getTranslations } from "@/i18n/server";
import Link from "@/components/version-link";
import { SearchX } from "lucide-react";
export default async function AbilityNotFound() {
  const t = await getTranslations();
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-5 py-20 text-center">
      <div>
        <SearchX className="mx-auto size-10 text-[var(--text-muted)]" />
        <p className="mt-5 text-[10px] uppercase tracking-[0.24em] text-[var(--accent-hover)]">
          {t("404 · 技能图鉴")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold">{t("未找到这个技能")}</h1>
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          {t("请返回技能图鉴搜索其他技能。")}
        </p>
        <Link
          href="/abilities"
          className="mt-7 inline-block px-5 py-3 text-xs "
        >
          {t("返回技能图鉴")}
        </Link>
      </div>
    </main>
  );
}
