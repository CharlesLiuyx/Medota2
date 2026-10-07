import { getTranslations } from "@/i18n/server";
export default async function LoadingUnits() {
  const t = await getTranslations();
  return (
    <main
      className="mx-auto max-w-[var(--content-max)] px-4 py-8 text-sm text-[var(--text-muted)]"
      role="status"
    >
      {t("正在读取单位资料…")}
    </main>
  );
}
