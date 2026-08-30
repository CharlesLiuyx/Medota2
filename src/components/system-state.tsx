import { AlertTriangle, DatabaseZap, Terminal } from "lucide-react";

export function SetupState({ error }: { error?: string }) {
  return (
    <section className="mx-auto max-w-2xl border border-[var(--border-default)] bg-[var(--surface-panel)] p-8 text-center sm:p-12">
      <DatabaseZap className="mx-auto size-10 text-[var(--accent-primary)]" />
      <h1 className="mt-5 text-2xl font-semibold text-[var(--text-primary)]">
        还没有可浏览的英雄数据
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[var(--text-muted)]">
        启动 PostgreSQL、执行迁移，然后从已配置且输入与 HEAD 一致的
        dota_vpk_updates checkout 导入。
      </p>
      <div className="mt-7 space-y-2 border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-4 text-left font-mono text-xs text-[var(--text-secondary)]">
        <p>
          <span className="text-[var(--text-muted)]">$</span> docker compose up
          -d
        </p>
        <p>
          <span className="text-[var(--text-muted)]">$</span> pnpm db:migrate
        </p>
        <p>
          <span className="text-[var(--text-muted)]">$</span> pnpm
          data:import:vpk
        </p>
      </div>
      {error && (
        <p className="mt-5 break-words text-left text-xs text-[var(--status-danger)]">
          {error}
        </p>
      )}
    </section>
  );
}

export function ImportFailureBanner({
  stage,
  message,
}: {
  stage: string;
  message: string | null;
}) {
  return (
    <aside className="flex items-start gap-3 border border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_7%,transparent)] px-4 py-3 text-xs text-[var(--text-secondary)]">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--status-warning)]" />
      <div>
        <p className="font-medium text-[var(--status-warning)]">
          最近一次 VPK 导入失败，当前页面继续使用上一个 active dataset。
        </p>
        <p className="mt-1 text-[var(--text-muted)]">
          阶段：{stage}
          {message ? ` · ${message}` : ""}
        </p>
      </div>
    </aside>
  );
}

export function EmptyResults() {
  return (
    <div className="border border-dashed border-[var(--border-default)] py-20 text-center">
      <Terminal className="mx-auto size-7 text-[var(--text-muted)]" />
      <p className="mt-4 text-sm text-[var(--text-secondary)]">
        当前 active dataset 中没有匹配英雄
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        尝试减少筛选条件或清除搜索词。
      </p>
    </div>
  );
}
