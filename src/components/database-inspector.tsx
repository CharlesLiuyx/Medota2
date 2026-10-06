"use client";

import { useEffect, useState } from "react";
import type {
  DatabaseOverview,
  DatabasePage,
} from "@/development/data-sync/view";
import styles from "@/app/dev/database/database.module.css";

const states: Record<string, string> = {
  "in-sync": "上次核验一致",
  "code-modified": "代码有未提交修改",
  "data-differs": "数据与目标不同",
  "dependencies-missing": "依赖不完整",
  "not-fetched": "目标快照尚未获取",
  unlocked: "尚未锁定同步版本",
  unprepared: "数据库未准备",
};
const bytes = (size: number) => `${(size / 1024 / 1024).toFixed(1)} MB`;
export function DatabaseInspector() {
  const [overview, setOverview] = useState<DatabaseOverview | null>(null);
  const [table, setTable] = useState("heroes");
  const [page, setPage] = useState<DatabasePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [column, setColumn] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState({ column: "", query: "" });
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/development/database", {
          cache: "no-store",
          signal: abort.signal,
        });
        if (!response.ok) throw new Error("无法连接当前工作区数据库");
        setOverview(await response.json());
      } catch (error) {
        if (!abort.signal.aborted) setError(String(error));
      }
    }
    void load();
    return () => abort.abort();
  }, [revision]);
  useEffect(() => {
    const abort = new AbortController();
    async function load() {
      try {
        const params = new URLSearchParams({
          table,
          offset: String(offset),
          limit: "50",
        });
        if (filter.query) {
          params.set("column", filter.column);
          params.set("q", filter.query);
        }
        const response = await fetch(`/api/development/database?${params}`, {
          cache: "no-store",
          signal: abort.signal,
        });
        if (!response.ok)
          throw new Error("记录读取失败，请检查筛选条件或开发日志");
        setPage(await response.json());
        setError("");
      } catch (error) {
        if (!abort.signal.aborted) setError(String(error));
      }
    }
    void load();
    return () => abort.abort();
  }, [table, offset, filter, revision]);
  const selected = overview?.tables.find((item) => item.name === table);
  const currentPage =
    page?.table === table && page.offset === offset ? page : null;
  function selectTable(name: string) {
    setTable(name);
    setOffset(0);
    setColumn("");
    setQuery("");
    setFilter({ column: "", query: "" });
    setPage(null);
  }
  return (
    <section className={styles.root} aria-label="开发数据库查看器">
      <div className={styles.heading}>
        <div>
          <h1>开发数据库</h1>
          <p>
            只读查看 · {overview?.workspace?.name ?? "当前工作区"} ·{" "}
            {overview?.environment.environment ?? "连接中"}
          </p>
        </div>
        <button onClick={() => setRevision((value) => value + 1)}>
          刷新记录
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.summary}>
        <div>
          <span>当前数据库</span>
          <strong>{overview?.environment.databaseName ?? "—"}</strong>
          <small>
            {overview?.environment.dataClass} ·{" "}
            {overview?.environment.safeFingerprint}
          </small>
        </div>
        <div>
          <span>目标快照</span>
          <strong>
            {overview?.target?.snapshotId.slice(0, 16) ?? "尚未配置"}
          </strong>
          <small>
            当前应用：{overview?.activeSnapshot?.slice(0, 16) ?? "原有开发数据"}
          </small>
        </div>
        <div>
          <span>上次完整核验</span>
          <strong>
            {overview?.lastVerification
              ? (states[overview.lastVerification.state] ??
                overview.lastVerification.state)
              : "尚无记录"}
          </strong>
          <small>
            {overview?.lastVerification?.checkedAt ?? "运行 pnpm data:status"}
          </small>
        </div>
        <div>
          <span>业务表与记录</span>
          <strong>
            {overview?.tables.length ?? "—"} 张表 ·{" "}
            {overview?.tables
              .reduce((sum, item) => sum + item.rows, 0)
              .toLocaleString() ?? "—"}{" "}
            条
          </strong>
          <small>
            {overview
              ? bytes(
                  overview.tables.reduce((sum, item) => sum + item.bytes, 0),
                )
              : "—"}
            （含索引）
          </small>
        </div>
      </div>
      <p className={styles.note}>
        记录从当前数据库读取。完整核验结果带有时间；要核对全部内容、图片与来源，请在该工作区运行{" "}
        <code>pnpm data:status</code>。
      </p>
      {overview?.lastVerification?.problems.map((problem) => (
        <p className={styles.error} key={problem}>
          {problem}
        </p>
      ))}
      <details className={styles.heads}>
        <summary>查看 Catalog／图片版本指针</summary>
        <pre>{JSON.stringify(overview?.heads ?? {}, null, 2)}</pre>
      </details>
      <div className={styles.browser}>
        <nav className={styles.tables} aria-label="数据库表">
          {overview?.tables.map((item) => (
            <button
              key={item.name}
              aria-pressed={table === item.name}
              onClick={() => selectTable(item.name)}
            >
              <span>{item.name}</span>
              <small>{item.rows.toLocaleString()}</small>
            </button>
          ))}
        </nav>
        <div className={styles.content}>
          <div className={styles.heading}>
            <h2>{table}</h2>
            <span>{selected?.rows.toLocaleString() ?? "—"} 条</span>
          </div>
          <details>
            <summary>列类型与主键</summary>
            <div className={styles.columns}>
              {selected?.columns.map((item) => (
                <span key={item.name}>
                  <strong>{item.name}</strong> {item.type}
                  {item.primary ? " · PK" : ""}
                  {item.nullable ? " · nullable" : ""}
                </span>
              ))}
            </div>
          </details>
          <form
            className={styles.filters}
            onSubmit={(event) => {
              event.preventDefault();
              setOffset(0);
              setPage(null);
              setFilter({ column, query });
            }}
          >
            <select
              aria-label="筛选字段"
              value={column}
              onChange={(event) => setColumn(event.target.value)}
            >
              <option value="">选择字段</option>
              {selected?.columns
                .filter((item) => item.type !== "bytea")
                .map((item) => (
                  <option value={item.name} key={item.name}>
                    {item.name}
                  </option>
                ))}
            </select>
            <input
              aria-label="筛选内容"
              placeholder="字段包含…"
              maxLength={200}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button disabled={Boolean(query && !column)}>筛选</button>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setColumn("");
                setFilter({ column: "", query: "" });
                setOffset(0);
              }}
            >
              清除
            </button>
          </form>
          <div className={styles.grid}>
            <table>
              <thead>
                <tr>
                  {table === "asset_blobs" && <th>图片</th>}
                  {selected?.columns.map((item) => (
                    <th key={item.name}>{item.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentPage?.rows.map((row, index) => (
                  <tr key={index}>
                    {table === "asset_blobs" && (
                      <td>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          alt="数据库图片预览"
                          loading="lazy"
                          width={64}
                          height={48}
                          src={`/api/development/database?image=${row.content_sha256}`}
                        />
                      </td>
                    )}
                    {selected?.columns.map((item) => (
                      <td key={item.name}>
                        <Cell
                          value={row[item.name]}
                          json={item.type === "jsonb"}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!currentPage && <p role="status">正在读取记录…</p>}
          {currentPage?.rows.length === 0 && <p>没有匹配记录。</p>}
          <div className={styles.pagination}>
            <button
              disabled={offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - 50))}
            >
              上一页
            </button>
            <span>第 {Math.floor(offset / 50) + 1} 页 · 每页 50 条</span>
            <button
              disabled={!currentPage?.hasMore}
              onClick={() => setOffset((value) => value + 50)}
            >
              下一页
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
function Cell({
  value,
  json,
}: {
  value: string | null | undefined;
  json: boolean;
}) {
  if (value === null || value === undefined)
    return <span className={styles.null}>NULL</span>;
  let display = value;
  if (json) {
    try {
      display = JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      /* Truncated JSON remains text. */
    }
  }
  if (json || value.length > 180)
    return (
      <details>
        <summary>
          {value.slice(0, 90)}
          {value.length > 90 ? "…" : ""}
        </summary>
        <pre>{display}</pre>
      </details>
    );
  return <span>{value}</span>;
}
