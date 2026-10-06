"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkbenchStatus } from "@/development/protocol";

export function DevelopmentWorkbench() {
  const [status, setStatus] = useState<WorkbenchStatus | null>(null);
  const [error, setError] = useState("");
  const previous = useRef<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch("/api/development", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("工作台暂时不可用");
        const next = (await response.json()) as WorkbenchStatus;
        if (stopped) return;
        setStatus(next);
        setError("");
        const key = `${next.instance}:${next.resultRevision}`;
        if (next.sample === "passed") {
          if (previous.current && previous.current !== key) router.refresh();
          previous.current = key;
        }
      } catch {
        if (!stopped) setError("连接中；服务恢复后会自动继续");
      } finally {
        if (!stopped) timer = setTimeout(poll, document.hidden ? 1500 : 350);
      }
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [router]);
  async function command(action: "rerun" | "cancel") {
    try {
      const response = await fetch("/api/development", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error("操作暂时无法执行");
      setError("");
    } catch {
      setError("操作暂时无法执行，请检查开发服务");
    }
  }
  const stale = status?.result && status.resultRevision !== status.revision;
  return (
    <aside
      className="development-workbench"
      aria-label="共享开发工作台"
      data-sample-state={status?.sample ?? "connecting"}
    >
      <details>
        <summary>
          <strong>共享开发</strong> ·{" "}
          {status?.dataSource === "local-review" ? "真实数据" : "开发数据"} ·{" "}
          {error || status?.message || "连接中"}
        </summary>
        <div className="development-workbench-body">
          <p>
            {status?.dataSource === "local-review"
              ? "页面：真实 Catalog 与已验收头像"
              : "页面：开发数据库，初始样例含占位图"}
            。下方小样例单独重算，使用真实解析器。
          </p>
          {status?.pendingSetup.map((message) => (
            <p role="status" key={message}>
              {message}
            </p>
          ))}
          <div className="development-workbench-actions">
            <a href="/dev/database">查看数据库与同步状态</a>
            <button type="button" onClick={() => void command("rerun")}>
              重算样例
            </button>
            <button
              type="button"
              onClick={() => void command("cancel")}
              disabled={
                !status || !["running", "queued"].includes(status.sample)
              }
            >
              取消计算
            </button>
          </div>
          {status?.result && (
            <>
              <p aria-live="polite">
                {stale ? "上一次结果（等待更新）" : "最新结果"} ·{" "}
                {status.result.heroes.length} 位英雄 · {status.result.abilities}{" "}
                项技能
              </p>
              <p>
                解析 {status.result.durationMs} ms · 进程峰值{" "}
                {status.result.peakMemoryMb} MB · 保存到结果{" "}
                {status.savedToResultMs ?? "—"} ms
              </p>
              <table>
                <thead>
                  <tr>
                    <th>英雄</th>
                    <th>移动速度</th>
                  </tr>
                </thead>
                <tbody>
                  {status.result.heroes.map((hero) => (
                    <tr key={hero.id}>
                      <td>{hero.name.replace("npc_dota_hero_", "")}</td>
                      <td>{hero.movementSpeed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                输入版本 {status.result.inputVersion.slice(0, 12)} · 结果版本{" "}
                {status.resultRevision}
              </p>
            </>
          )}
          {status?.changedFiles.length ? (
            <p>本次变化：{status.changedFiles.join("、")}</p>
          ) : null}
        </div>
      </details>
    </aside>
  );
}
