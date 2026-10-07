import { getTranslations } from "@/i18n/server";
import Link from "@/components/version-link";
import { SearchX } from "lucide-react";
export default async function NotFound() {
  const t = await getTranslations();
  return (
    <main className="mx-auto grid min-h-[70vh] max-w-xl place-items-center px-5 py-20 text-center">
      <div>
        <SearchX className="mx-auto size-10 text-zinc-700" />
        <p className="mt-5 text-[10px] uppercase tracking-[0.24em] text-[#cb5b40]">
          {t("404 · 资料未收录")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-white">
          {t("所选版本或页面未收录")}
        </h1>
        <p className="mt-3 text-sm text-zinc-500">
          {t("请在顶栏选择已收录的版本，或返回默认图鉴。")}
        </p>
        <Link
          href="/heroes"
          className="mt-7 inline-block px-5 py-3 text-xs text-zinc-300 hover:text-white"
        >
          {t("返回默认图鉴")}
        </Link>
      </div>
    </main>
  );
}
