"use client";
export default function UnitError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto min-h-[60vh] max-w-[var(--content-max)] px-4 py-12">
      <h1 className="text-xl">单位资料读取失败</h1>
      <p className="mt-3 text-sm text-[var(--text-muted)]">
        请检查当前版本的数据来源，或稍后重试。
      </p>
      <button onClick={reset} className="mt-4 bg-white/5 px-3 py-2 text-xs">
        重新读取
      </button>
    </main>
  );
}
