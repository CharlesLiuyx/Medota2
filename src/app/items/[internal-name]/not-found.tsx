import { getTranslations } from "@/i18n/server";
import Link from "@/components/version-link";
export default async function ItemNotFound() {
  const t = await getTranslations();
  return (
    <main className="px-6 py-16">
      <h1 className="text-xl">{t("未找到该物品")}</h1>
      <Link href="/items" className="mt-4 block text-sm">
        {t("返回物品图鉴")}
      </Link>
    </main>
  );
}
