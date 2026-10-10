"use client";

import {
  useEffect,
  useRef,
  useCallback,
  useState,
  type ComponentProps,
} from "react";
import { attachTableStickyCells } from "./table-sticky-cells";
import { createPortal } from "react-dom";
import { Pin } from "lucide-react";
import { useTranslations } from "@/i18n/provider";
import { attachTableFrozenColumns } from "./table-frozen-columns";
import styles from "./data-table.module.css";

/** Native table semantics; layout and scroll containers remain owned by the caller. */
export function DataTable({
  ref,
  frozenCount: controlledCount,
  onFrozenCountChange,
  freezeControls = true,
  className = "",
  ...props
}: ComponentProps<"table"> & {
  frozenCount?: number;
  onFrozenCountChange?: (count: number) => void;
  freezeControls?: boolean;
}) {
  const t = useTranslations();
  const [count, setCount] = useState(1);
  const frozenCount = controlledCount ?? count;
  const [headers, setHeaders] = useState<HTMLElement[]>([]);
  const table = useRef<HTMLTableElement>(null);
  useEffect(() => {
    if (table.current) return attachTableStickyCells(table.current);
  }, []);
  useEffect(() => {
    if (table.current)
      return attachTableFrozenColumns(table.current, frozenCount);
  }, [frozenCount]);
  useEffect(() => {
    if (!freezeControls || !table.current) return;
    const node = table.current;
    const refresh = () => {
      const next = [...(node.tHead?.rows[0]?.cells ?? [])].map((header) => {
        const parent =
          header.querySelector("[data-table-header-content]") ?? header;
        let host = parent.querySelector<HTMLElement>(
          ":scope > [data-table-freeze-control]",
        );
        if (!host) {
          host = document.createElement("span");
          host.setAttribute("data-table-freeze-control", "");
          parent.append(host);
        }
        return host;
      });
      setHeaders((previous) =>
        previous.length === next.length &&
        previous.every((cell, i) => cell === next[i])
          ? previous
          : next,
      );
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(node, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [freezeControls]);
  const setRef = useCallback(
    (node: HTMLTableElement | null) => {
      table.current = node;
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
    },
    [ref],
  );
  return (
    <>
      <table
        {...props}
        className={`${styles.table} ${className}`}
        data-table=""
        data-frozen-count={frozenCount}
        ref={setRef}
      />
      {freezeControls &&
        headers.map((header, index) =>
          createPortal(
            <button
              type="button"
              className={styles.freeze}
              aria-label={t("冻结至第{count}列", { count: index + 1 })}
              title={t(index + 1 === frozenCount ? "取消冻结" : "冻结至此列")}
              aria-pressed={index + 1 === frozenCount}
              onClick={() => {
                const next = index + 1 === frozenCount ? 0 : index + 1;
                setCount(next);
                onFrozenCountChange?.(next);
              }}
            >
              <Pin size={11} aria-hidden />
            </button>,
            header,
            String(index),
          ),
        )}
    </>
  );
}

/** All merged cells use this primitive, including rowSpan=0 (to the group's end). */
export function TableCell({
  as: Cell = "td",
  rowSpan,
  style,
  children,
  ...props
}: ComponentProps<"td"> & { as?: "td" | "th"; scope?: string }) {
  const merged = rowSpan !== undefined && rowSpan !== 1;
  return (
    <Cell
      {...props}
      rowSpan={rowSpan}
      style={merged ? { ...style, verticalAlign: "top" } : style}
    >
      {merged ? (
        <div data-table-merged-slot="">
          <div data-table-merged-content="" className={styles.merged}>
            {children}
          </div>
        </div>
      ) : (
        children
      )}
    </Cell>
  );
}

/** Keep original header content and its native column width while it is pinned. */
export function TableHeaderCell({
  children,
  style,
  ...props
}: ComponentProps<"th">) {
  return (
    <th {...props} style={{ ...style, padding: 0 }}>
      <div data-table-header-slot="">
        <div
          data-table-header-content=""
          className={`${styles.merged} ${styles.header}`}
        >
          {children}
        </div>
      </div>
    </th>
  );
}
