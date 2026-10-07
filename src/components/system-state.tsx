"use client";
import { useTranslations } from "@/i18n/provider";
import { AlertTriangle, DatabaseZap, Terminal } from "lucide-react";
export function SetupState({ error }: { error?: string }) {
  const t = useTranslations();
  return (
    <section className="mx-auto max-w-2xl bg-[var(--surface-panel)] p-8 text-center sm:p-12">
      <DatabaseZap className="mx-auto size-10 text-[var(--accent-primary)]" />
      <h1 className="mt-5 text-2xl font-semibold text-[var(--text-primary)]">
        {t("还没有可浏览的英雄数据")}
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[var(--text-muted)]">
        {error
          ? t("暂时无法加载游戏资料，请稍后刷新重试。")
          : t("游戏资料尚未准备好，请完成资料导入后再来浏览。")}
      </p>
    </section>
  );
}
export function ImportFailureBanner({}: {
  stage: string;
  message: string | null;
}) {
  const t = useTranslations();
  return (
    <aside className="flex items-start gap-3 bg-[color-mix(in_srgb,var(--status-warning)_7%,transparent)] px-4 py-3 text-xs text-[var(--text-secondary)]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--status-warning)]" />
      <div>
        <p className="font-medium text-[var(--status-warning)]">
          {t("资料更新暂未完成，当前显示上一次可用的游戏资料。")}
        </p>
      </div>
    </aside>
  );
}
export function EmptyResults() {
  const t = useTranslations();
  return (
    <div className="py-20 text-center">
      <Terminal className="mx-auto size-7 text-[var(--text-muted)]" />
      <p className="mt-4 text-sm text-[var(--text-secondary)]">
        {t("没有找到符合条件的英雄")}
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {t("尝试减少筛选条件或清除搜索词。")}
      </p>
    </div>
  );
}
