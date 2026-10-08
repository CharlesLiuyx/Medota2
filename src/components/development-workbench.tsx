"use client";
import { DataTable } from "@/components/ui/data-table";
import { useLocale } from "@/i18n/provider";
import { diagnosticText } from "@/i18n/diagnostics";
import { Message, useTranslations } from "@/i18n/provider";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { WorkbenchStatus } from "@/development/protocol";
export function DevelopmentWorkbench() {
  const t = useTranslations();
  const locale = useLocale();
  const [status, setStatus] = useState<WorkbenchStatus | null>(null);
  const [error, setError] = useState("");
  const previous = useRef<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let inFlight = false;
    let lastStatus = "";
    async function poll() {
      if (stopped || document.hidden || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/development", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(t("工作台暂时不可用"));
        const next = (await response.json()) as WorkbenchStatus;
        if (stopped) return;
        const serialized = JSON.stringify(next);
        if (serialized !== lastStatus) {
          lastStatus = serialized;
          setStatus(next);
        }
        setError("");
        const key = `${next.instance}:${next.resultRevision}`;
        if (next.sample === "passed") {
          if (previous.current && previous.current !== key) router.refresh();
          previous.current = key;
        }
      } catch {
        if (!stopped) setError(t("连接中；服务恢复后会自动继续"));
      } finally {
        inFlight = false;
        if (!stopped && !document.hidden) timer = setTimeout(poll, 350);
      }
    }
    const onVisibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", onVisibility);
      controller.abort();
      clearTimeout(timer);
    };
  }, [router, t]);
  async function command(action: "rerun" | "cancel") {
    try {
      const response = await fetch("/api/development", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) throw new Error(t("操作暂时无法执行"));
      setError("");
    } catch {
      setError(t("操作暂时无法执行，请检查开发服务"));
    }
  }
  const stale = status?.result && status.resultRevision !== status.revision;
  return (
    <aside
      className="development-workbench"
      aria-label={t("共享开发工作台")}
      data-sample-state={status?.sample ?? "connecting"}
    >
      <details>
        <summary>
          <strong>{t("共享开发")}</strong> ·{" "}
          {status?.dataSource === "local-review"
            ? t("真实数据")
            : t("开发数据")}{" "}
          · {diagnosticText(locale, error || status?.message || t("连接中"))}
        </summary>
        <div className="development-workbench-body">
          <p>
            <Message
              id="{value0}。下方小样例单独重算，使用真实解析器。"
              values={{
                value0:
                  status?.dataSource === "local-review"
                    ? t("页面：真实 Catalog 与已验收头像")
                    : t("页面：开发数据库，初始样例含占位图"),
              }}
            />
          </p>
          {status?.pendingSetup.map((message) => (
            <p role="status" key={diagnosticText(locale, message)}>
              {diagnosticText(locale, message)}
            </p>
          ))}
          <div className="development-workbench-actions">
            <a href="/dev/database">{t("查看数据库与同步状态")}</a>
            <button type="button" onClick={() => void command("rerun")}>
              {t("重算样例")}
            </button>
            <button
              type="button"
              onClick={() => void command("cancel")}
              disabled={
                !status || !["running", "queued"].includes(status.sample)
              }
            >
              {t("取消计算")}
            </button>
          </div>
          {status?.result && (
            <>
              <p aria-live="polite">
                <Message
                  id="{value0} · {value1} 位英雄 · {value2} 项技能"
                  values={{
                    value0: stale ? t("上一次结果（等待更新）") : t("最新结果"),
                    value1: status.result.heroes.length,
                    value2: status.result.abilities,
                  }}
                />
              </p>
              <p>
                <Message
                  id="解析 {value0} ms · 进程峰值 {value1} MB · 保存到结果 {value2} ms"
                  values={{
                    value0: status.result.durationMs,
                    value1: status.result.peakMemoryMb,
                    value2: status.savedToResultMs ?? "—",
                  }}
                />
              </p>
              <DataTable>
                <thead>
                  <tr>
                    <th>{t("英雄")}</th>
                    <th>{t("移动速度")}</th>
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
              </DataTable>
              <p>
                <Message
                  id="输入版本 {value0} · 结果版本 {value1}"
                  values={{
                    value0: status.result.inputVersion.slice(0, 12),
                    value1: status.resultRevision,
                  }}
                />
              </p>
            </>
          )}
          {status?.changedFiles.length ? (
            <p>
              <Message
                id="本次变化：{value0}"
                values={{
                  value0: status.changedFiles.join("、"),
                }}
              />
            </p>
          ) : null}
        </div>
      </details>
    </aside>
  );
}
