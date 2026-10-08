"use client";
import { DataTable } from "@/components/ui/data-table";
import { Message, useLocale, useTranslations } from "@/i18n/provider";

import { formatNumber } from "@/i18n/format";
import { useEffect, useState } from "react";
import { CompactSelect } from "./ui/compact-select";
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
  const t = useTranslations();
  const locale = useLocale();
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
        if (!response.ok) throw new Error(t("无法连接当前工作区数据库"));
        setOverview(await response.json());
      } catch (error) {
        if (!abort.signal.aborted) setError(String(error));
      }
    }
    void load();
    return () => abort.abort();
  }, [revision, t]);
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
          throw new Error(t("记录读取失败，请检查筛选条件或开发日志"));
        setPage(await response.json());
        setError("");
      } catch (error) {
        if (!abort.signal.aborted) setError(String(error));
      }
    }
    void load();
    return () => abort.abort();
  }, [table, offset, filter, revision, t]);
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
    <section className={styles.root} aria-label={t("开发数据库查看器")}>
      <div className={styles.heading}>
        <div>
          <h1>{t("开发数据库")}</h1>
          <p>
            <Message
              id="只读查看 · {value0} · {value1}"
              values={{
                value0: overview?.workspace?.name ?? t("当前工作区"),
                value1: overview?.environment.environment ?? t("连接中"),
              }}
            />
          </p>
        </div>
        <button onClick={() => setRevision((value) => value + 1)}>
          {t("刷新记录")}
        </button>
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.summary}>
        <div>
          <span>{t("当前数据库")}</span>
          <strong>{overview?.environment.databaseName ?? "—"}</strong>
          <small>
            {overview?.environment.dataClass} ·{" "}
            {overview?.environment.safeFingerprint}
          </small>
        </div>
        <div>
          <span>{t("目标快照")}</span>
          <strong>
            {overview?.target?.snapshotId.slice(0, 16) ?? t("尚未配置")}
          </strong>
          <small>
            <Message
              id="当前应用：{value0}"
              values={{
                value0:
                  overview?.activeSnapshot?.slice(0, 16) ?? t("原有开发数据"),
              }}
            />
          </small>
        </div>
        <div>
          <span>{t("上次完整核验")}</span>
          <strong>
            {overview?.lastVerification
              ? t(
                  states[overview.lastVerification.state] ??
                    overview.lastVerification.state,
                )
              : t("尚无记录")}
          </strong>
          <small>
            {overview?.lastVerification?.checkedAt ??
              t("运行 pnpm data:status")}
          </small>
        </div>
        <div>
          <span>{t("业务表与记录")}</span>
          <strong>
            <Message
              id="{value0} 张表 · {value1} 条"
              values={{
                value0: overview?.tables.length ?? "—",
                value1: overview
                  ? formatNumber(
                      locale,
                      overview.tables.reduce((sum, item) => sum + item.rows, 0),
                    )
                  : "—",
              }}
            />
          </strong>
          <small>
            <Message
              id="{value0}（含索引）"
              values={{
                value0: overview
                  ? bytes(
                      overview.tables.reduce(
                        (sum, item) => sum + item.bytes,
                        0,
                      ),
                    )
                  : "—",
              }}
            />
          </small>
        </div>
      </div>
      <p className={styles.note}>
        <Message
          id="记录从当前数据库读取。完整核验结果带有时间；要核对全部内容、图片与来源，请在该工作区运行 {value0}。"
          values={{
            value0: <code>pnpm data:status</code>,
          }}
        />
      </p>
      {overview?.lastVerification?.problems.map((problem) => (
        <p className={styles.error} key={problem}>
          <code>{problem}</code>
        </p>
      ))}
      <details className={styles.heads}>
        <summary>{t("查看 Catalog／图片版本指针")}</summary>
        <pre>{JSON.stringify(overview?.heads ?? {}, null, 2)}</pre>
      </details>
      <div className={styles.browser}>
        <nav className={styles.tables} aria-label={t("数据库表")}>
          {overview?.tables.map((item) => (
            <button
              key={item.name}
              aria-pressed={table === item.name}
              onClick={() => selectTable(item.name)}
            >
              <span>{item.name}</span>
              <small>{formatNumber(locale, item.rows)}</small>
            </button>
          ))}
        </nav>
        <div className={styles.content}>
          <div className={styles.heading}>
            <h2>{table}</h2>
            <span>
              <Message
                id="{value0} 条"
                values={{
                  value0: selected ? formatNumber(locale, selected.rows) : "—",
                }}
              />
            </span>
          </div>
          <details>
            <summary>{t("列类型与主键")}</summary>
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
            <CompactSelect
              label={t("筛选字段")}
              name="column"
              hideLabel
              value={column}
              onValueChange={setColumn}
            >
              <option value="">{t("选择字段")}</option>
              {selected?.columns
                .filter((item) => item.type !== "bytea")
                .map((item) => (
                  <option value={item.name} key={item.name}>
                    {item.name}
                  </option>
                ))}
            </CompactSelect>
            <input
              aria-label={t("筛选内容")}
              placeholder={t("字段包含…")}
              maxLength={200}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button disabled={Boolean(query && !column)}>{t("筛选")}</button>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setColumn("");
                setFilter({ column: "", query: "" });
                setOffset(0);
              }}
            >
              {t("清除")}
            </button>
          </form>
          <div className={styles.grid}>
            <DataTable>
              <thead>
                <tr>
                  {table === "asset_blobs" && <th>{t("图片")}</th>}
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
                          alt={t("数据库图片预览")}
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
            </DataTable>
          </div>
          {!currentPage && <p role="status">{t("正在读取记录…")}</p>}
          {currentPage?.rows.length === 0 && <p>{t("没有匹配记录。")}</p>}
          <div className={styles.pagination}>
            <button
              disabled={offset === 0}
              onClick={() => setOffset((value) => Math.max(0, value - 50))}
            >
              {t("上一页")}
            </button>
            <span>
              <Message
                id="第 {value0} 页 · 每页 50 条"
                values={{
                  value0: Math.floor(offset / 50) + 1,
                }}
              />
            </span>
            <button
              disabled={!currentPage?.hasMore}
              onClick={() => setOffset((value) => value + 50)}
            >
              {t("下一页")}
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
        <summary data-source-text="">
          {value.slice(0, 90)}
          {value.length > 90 ? "…" : ""}
        </summary>
        <pre>{display}</pre>
      </details>
    );
  return <span data-source-text="">{value}</span>;
}
