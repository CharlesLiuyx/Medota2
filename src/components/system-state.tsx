import { AlertTriangle, DatabaseZap, Terminal } from "lucide-react";

export function SetupState({ error }: { error?: string }) {
  return (
    <section className="mx-auto max-w-2xl border border-white/10 bg-[#131519] p-8 text-center sm:p-12">
      <DatabaseZap className="mx-auto size-10 text-[#d85a3a]" />
      <h1 className="mt-5 text-2xl font-semibold text-white">
        还没有可浏览的英雄数据
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-zinc-500">
        启动 PostgreSQL、执行迁移，然后从已配置且输入与 HEAD 一致的
        dota_vpk_updates checkout 导入。
      </p>
      <div className="mt-7 space-y-2 border border-white/8 bg-black/25 p-4 text-left font-mono text-xs text-zinc-400">
        <p>
          <span className="text-zinc-600">$</span> docker compose up -d
        </p>
        <p>
          <span className="text-zinc-600">$</span> pnpm db:migrate
        </p>
        <p>
          <span className="text-zinc-600">$</span> pnpm data:import:vpk
        </p>
      </div>
      {error && (
        <p className="mt-5 break-words text-left text-xs text-red-300/80">
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
    <aside className="flex items-start gap-3 border border-amber-400/20 bg-amber-300/5 px-4 py-3 text-xs text-amber-100/75">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" />
      <div>
        <p className="font-medium text-amber-200">
          最近一次 VPK 导入失败，当前页面继续使用上一个 active dataset。
        </p>
        <p className="mt-1 text-amber-100/55">
          阶段：{stage}
          {message ? ` · ${message}` : ""}
        </p>
      </div>
    </aside>
  );
}

export function EmptyResults() {
  return (
    <div className="border border-dashed border-white/12 py-20 text-center">
      <Terminal className="mx-auto size-7 text-zinc-700" />
      <p className="mt-4 text-sm text-zinc-400">
        当前 active dataset 中没有匹配英雄
      </p>
      <p className="mt-1 text-xs text-zinc-600">
        尝试减少筛选条件或清除搜索词。
      </p>
    </div>
  );
}
