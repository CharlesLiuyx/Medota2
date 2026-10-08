"use client";

import { useEffect, useRef, useCallback, type ComponentProps } from "react";
import { attachTableStickyCells } from "./table-sticky-cells";
import styles from "./data-table.module.css";

/** Native table semantics; layout and scroll containers remain owned by the caller. */
export function DataTable({ ref, ...props }: ComponentProps<"table">) {
  const table = useRef<HTMLTableElement>(null);
  useEffect(() => {
    if (table.current) return attachTableStickyCells(table.current);
  }, []);
  const setRef = useCallback(
    (node: HTMLTableElement | null) => {
      table.current = node;
      if (typeof ref === "function") return ref(node);
      if (ref) ref.current = node;
    },
    [ref],
  );
  return <table {...props} data-table="" ref={setRef} />;
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
