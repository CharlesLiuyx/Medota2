import { getTranslations } from "@/i18n/server";
import Link from "@/components/version-link";
export default async function UnitNotFound() {
  const t = await getTranslations();
  return (
    <main className="px-6 py-16">
      <h1 className="text-xl">{t("未找到该单位")}</h1>
      <Link href="/units" className="mt-4 block text-sm">
        {t("返回单位图鉴")}
      </Link>
    </main>
  );
}
