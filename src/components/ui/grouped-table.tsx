"use client";

import {
  memo,
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useInfiniteList, type InfiniteListChunk } from "../infinite-list";
import { DataTable, TableCell, TableHeaderCell } from "./data-table";
import { tableCellSpans, type CellSpan } from "./table-cell-spans";
import styles from "./grouped-table.module.css";

export interface TableGroup<Row> {
  key: string;
  rows: Row[];
}
export interface GroupedTableColumn<Group, Row> {
  key: string;
  header: ReactNode;
  /** A merged column describes the whole item, independent of its property rows. */
  merged?: boolean;
  /** Equal keys merge in both directions, including across adjacent groups. */
  mergeKey?: (row: Row, group: Group, index: number) => string | undefined;
  width?: number | string;
  /** Non-interactive samples from the complete filtered data, independent of virtual chunks. */
  widthSample?: ReactNode;
  /** Short content keeps its natural single-line width; longer prose wraps at the cap. */
  fitContent?: boolean;
  maxContentWidth?: number | string;
  className?: string;
  cellProps?: (row: Row) => ComponentProps<"td"> & DataAttributes;
  render: (row: Row, group: Group, index: number) => ReactNode;
}
type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

type PlannedRow<Row, Group> = {
  row: Row;
  group: Group;
  index: number;
  spans: (CellSpan | null)[];
};
type TableBlock<Row, Group> = { key: string; rows: PlannedRow<Row, Group>[] };

/** Every virtual block includes complete groups and complete merged rectangles. */
export function GroupedTable<Row, Group extends TableGroup<Row>>({
  groups,
  columns,
  identity,
  label,
  rowKey,
  rowProps,
  groupProps,
  minWidth = 640,
  empty,
}: {
  groups: Group[];
  columns: GroupedTableColumn<Group, Row>[];
  identity: string;
  label: string;
  rowKey: (row: Row) => string;
  rowProps?: (
    row: Row,
    group: Group,
    index: number,
  ) => ComponentProps<"tr"> & DataAttributes;
  /** Props for the first row of an original group, even inside a larger merged block. */
  groupProps?: (group: Group) => ComponentProps<"tr"> & DataAttributes;
  minWidth?: number;
  empty?: ReactNode;
}) {
  const items = useMemo(() => {
    const rows = groups.flatMap((group) =>
      group.rows.map((row, index) => ({ row, group, index })),
    );
    const keys = rows.map(({ row, group, index }) =>
      columns.map(
        (column) =>
          column.mergeKey?.(row, group, index) ??
          (column.merged ? `group:${group.key}:${column.key}` : undefined),
      ),
    );
    const spans = tableCellSpans(
      keys,
      columns.map((column) => !!column.merged),
    );
    const blocks: TableBlock<Row, Group>[] = [];
    let start = 0,
      end = 0;
    for (let i = 0; i < rows.length; i++) {
      end = Math.max(
        end,
        i + rows[i].group.rows.length - rows[i].index,
        ...spans[i].map((span) => i + (span?.rowSpan ?? 1)),
      );
      if (i + 1 < end) continue;
      blocks.push({
        key: rows[start].group.key,
        rows: rows
          .slice(start, end)
          .map((row, offset) => ({ ...row, spans: spans[start + offset] })),
      });
      start = end;
    }
    return blocks;
  }, [groups, columns]);
  const {
    rootRef,
    topSentinelRef,
    bottomSentinelRef,
    chunkRef,
    chunks,
    isBusy,
  } = useInfiniteList({
    source: { kind: "local", items, chunkSize: 1, identity },
    getKey: (group) => group.key,
  });
  const tableRef = useRef<HTMLTableElement>(null);
  const measurementsRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const table = tableRef.current;
    const measurements = measurementsRef.current;
    if (!table || !measurements) return;
    let disposed = false;
    const samples = [...measurements.children] as HTMLElement[];
    const measure = () => {
      if (disposed) return;
      const widths = samples.map((sample) => ({
        index: sample.dataset.column,
        width: Math.ceil(sample.getBoundingClientRect().width) + 16,
      }));
      for (const { index, width } of widths)
        table.style.setProperty(`--table-column-${index}-width`, `${width}px`);
    };
    measure();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    samples.forEach((sample) => observer?.observe(sample));
    void document.fonts?.ready.then(measure);
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [columns, items.length]);
  if (!items.length) return empty ?? null;
  return (
    <div
      ref={rootRef}
      data-infinite-list=""
      aria-busy={isBusy}
      className={styles.scroll}
    >
      <div
        ref={measurementsRef}
        className={styles.measurements}
        aria-hidden="true"
        inert
      >
        {columns.map(
          (column, index) =>
            column.widthSample != null && (
              <div
                key={column.key}
                data-column={index}
                className={styles.measureColumn}
              >
                <div className={styles.measureHeader}>{column.header}</div>
                <div
                  className={styles.measureBody}
                  data-merged={column.merged || undefined}
                  style={{ maxWidth: column.maxContentWidth ?? 320 }}
                >
                  {column.widthSample}
                </div>
              </div>
            ),
        )}
      </div>
      <DataTable
        ref={tableRef}
        className={styles.table}
        style={{ minWidth }}
        aria-label={label}
      >
        <colgroup>
          {columns.map((column, index) => (
            <col
              key={column.key}
              style={{
                width:
                  column.widthSample != null
                    ? `var(--table-column-${index}-width, ${typeof column.width === "number" ? `${column.width}px` : (column.width ?? "120px")})`
                    : column.width,
              }}
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <TableHeaderCell key={column.key} scope="col">
                {column.header}
              </TableHeaderCell>
            ))}
          </tr>
        </thead>
        <tbody aria-hidden="true">
          <tr>
            <td colSpan={columns.length} className={styles.sentinel}>
              <div
                ref={topSentinelRef}
                data-infinite-list-sentinel="before"
                data-infinite-boundary="before"
              />
            </td>
          </tr>
        </tbody>
        {chunks.map((chunk) => (
          <GroupedTableChunk
            key={chunk.id}
            chunk={chunk}
            chunkRef={chunkRef}
            columns={columns}
            rowKey={rowKey}
            rowProps={rowProps}
            groupProps={groupProps}
          />
        ))}
        <tbody aria-hidden="true">
          <tr>
            <td colSpan={columns.length} className={styles.sentinel}>
              <div
                ref={bottomSentinelRef}
                data-infinite-list-sentinel="after"
                data-infinite-boundary="after"
              />
            </td>
          </tr>
        </tbody>
      </DataTable>
    </div>
  );
}

// Stable refs preserve observers; unchanged groups skip row/tooltip rendering.
function TableChunk<Row, Group extends TableGroup<Row>>({
  chunk,
  chunkRef,
  columns,
  rowKey,
  rowProps,
  groupProps,
}: Pick<
  Parameters<typeof GroupedTable<Row, Group>>[0],
  "columns" | "rowKey" | "rowProps" | "groupProps"
> & {
  chunk: InfiniteListChunk<TableBlock<Row, Group>>;
  chunkRef: (id: string, node: HTMLElement | null) => void;
}) {
  const setRef = useCallback(
    (node: HTMLTableSectionElement | null) => chunkRef(chunk.id, node),
    [chunk.id, chunkRef],
  );
  return (
    <tbody
      ref={setRef}
      data-infinite-list-chunk=""
      data-infinite-chunk-id={chunk.id}
    >
      {chunk.rendered ? (
        chunk.items.flatMap((block) =>
          block.rows.map(({ row, group, index, spans }) => (
            <tr
              {...(index === 0 ? groupProps?.(group) : {})}
              {...rowProps?.(row, group, index)}
              key={`${group.key}:${rowKey(row)}`}
              data-table-group={group.key}
              data-infinite-list-item=""
            >
              {columns.map((column, columnIndex) => {
                const span = spans[columnIndex];
                if (!span) return null;
                // Preserve column markers when before/after cells become one cell.
                const props = Object.assign(
                  {},
                  ...columns
                    .slice(columnIndex, columnIndex + span.colSpan)
                    .map((c) => c.cellProps?.(row)),
                );
                return (
                  <TableCell
                    {...props}
                    key={column.key}
                    as={column.merged ? "th" : "td"}
                    scope={column.merged ? "row" : undefined}
                    rowSpan={span.rowSpan}
                    colSpan={span.colSpan}
                    className={column.className}
                    data-table-column={column.key}
                  >
                    {column.fitContent ? (
                      <div
                        className={styles.fitContent}
                        style={
                          {
                            "--table-content-max":
                              typeof column.maxContentWidth === "number"
                                ? `${column.maxContentWidth}px`
                                : column.maxContentWidth,
                          } as CSSProperties
                        }
                      >
                        {column.render(row, group, index)}
                      </div>
                    ) : (
                      column.render(row, group, index)
                    )}
                  </TableCell>
                );
              })}
            </tr>
          )),
        )
      ) : (
        <tr aria-hidden="true">
          <td colSpan={columns.length} className={styles.spacer}>
            <div
              data-infinite-list-spacer=""
              style={{ height: chunk.measuredHeight ?? 0 }}
            />
          </td>
        </tr>
      )}
    </tbody>
  );
}
const GroupedTableChunk = memo(TableChunk) as typeof TableChunk;
