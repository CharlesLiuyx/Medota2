"use client";

import {
  memo,
  useCallback,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useInfiniteList, type InfiniteListChunk } from "../infinite-list";
import { prepareTextWidthSamples } from "./text-width-sample";
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
  /** Adjacent columns share a parent heading, split at the frozen boundary. */
  headerGroup?: { key: string; label: ReactNode };
  /** Optional inert header measurement, avoiding duplicate interactive components. */
  headerWidthSample?: ReactNode;
  headerProps?: ComponentProps<"th"> & DataAttributes;
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
  spans?: (CellSpan | null)[];
};
type TableBlock<Row, Group> = { key: string; rows: PlannedRow<Row, Group>[] };
type ColumnRange = { start: number; end: number; hidden: boolean };

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
  fitWidth = false,
  frozenCount: controlledFrozenCount,
  windowColumns = false,
  focusedColumn,
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
  /** Use the measured column total instead of stretching to the parent width. */
  fitWidth?: boolean;
  frozenCount?: number;
  /** Catalog rows merge only horizontally; mount a window for very wide tables. */
  windowColumns?: boolean;
  focusedColumn?: string;
  empty?: ReactNode;
}) {
  const [localFrozenCount, setLocalFrozenCount] = useState(1);
  const frozenCount = controlledFrozenCount ?? localFrozenCount;
  const rowHeights = useMemo(
    () => ({ identity, frozenCount, values: new Map<string, number>() }),
    [identity, frozenCount],
  ).values;
  const hasHeaderGroups = columns.some((column) => column.headerGroup);
  const useColumnWindow =
    windowColumns &&
    columns.length > 64 &&
    !hasHeaderGroups &&
    !columns.some((column) => column.merged);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ left: 0, width: 1280 });
  const [measuredWidths, setMeasuredWidths] = useState<number[]>([]);
  const previousColumns = useRef<string[]>([]);
  const previousFocus = useRef<string | undefined>(undefined);
  const focusTarget = useRef<string | undefined>(focusedColumn);
  const columnRanges = useMemo(() => {
    if (!useColumnWindow)
      return [{ start: 0, end: columns.length, hidden: false }];
    const widths = columns.map(
      (column, index) =>
        measuredWidths[index] ??
        (typeof column.width === "number" ? column.width : 120),
    );
    const frozenWidth = widths
      .slice(0, frozenCount)
      .reduce((sum, width) => sum + width, 0);
    const ranges: ColumnRange[] = [];
    let left = 0;
    for (let index = 0; index < columns.length; index++) {
      const right = left + widths[index];
      const hidden =
        index >= frozenCount &&
        (right < viewport.left + frozenWidth - 480 ||
          left > viewport.left + viewport.width + 480);
      const previous = ranges.at(-1);
      if (previous?.hidden === hidden) previous.end = index + 1;
      else ranges.push({ start: index, end: index + 1, hidden });
      left = right;
    }
    return ranges;
  }, [columns, measuredWidths, frozenCount, viewport, useColumnWindow]);
  const headerGroups: { column: (typeof columns)[number]; span: number }[] = [];
  columns.forEach((column, index) => {
    const previous = headerGroups.at(-1);
    if (
      column.headerGroup &&
      previous?.column.headerGroup?.key === column.headerGroup.key &&
      index !== frozenCount
    )
      previous.span++;
    else headerGroups.push({ column, span: 1 });
  });
  const items = useMemo(() => {
    // Catalog objects never merge vertically. Plan their horizontal spans only
    // for mounted row chunks, avoiding an all-objects × all-columns matrix.
    if (useColumnWindow)
      return groups.map((group) => ({
        key: group.key,
        rows: group.rows.map((row, index) => ({ row, group, index })),
      })) as TableBlock<Row, Group>[];
    const rows = groups.flatMap((group) =>
      group.rows.map((row, index) => ({ row, group, index })),
    );
    const keys = rows.map(({ row, group, index }) =>
      columns.map((column, columnIndex) => {
        const key =
          column.mergeKey?.(row, group, index) ??
          (column.merged ? `group:${group.key}:${column.key}` : undefined);
        return key === undefined
          ? undefined
          : `${columnIndex < frozenCount ? "frozen" : "flow"}:${key}`;
      }),
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
  }, [groups, columns, frozenCount, useColumnWindow]);
  const {
    rootRef,
    topSentinelRef,
    bottomSentinelRef,
    chunkRef,
    chunks,
    isBusy,
  } = useInfiniteList({
    source: {
      kind: "local",
      items,
      chunkSize: 1,
      identity: `${identity}:frozen=${frozenCount}`,
    },
    getKey: (group) => group.key,
  });
  const tableRef = useRef<HTMLTableElement>(null);
  const measurementsRef = useRef<HTMLDivElement>(null);
  const preserveRowHeights = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    // Removing an offscreen description must not collapse its row and move the
    // vertical scroll position. New content may still grow a row naturally.
    const rows = [
      ...table.querySelectorAll<HTMLElement>(
        "thead, tr[data-infinite-list-item]",
      ),
    ];
    const heights = rows.map((row) =>
      Math.ceil(row.getBoundingClientRect().height),
    );
    rows.forEach((row, index) => {
      row.style.height = `${heights[index]}px`;
      if (row.dataset.heightKey)
        rowHeights.set(row.dataset.heightKey, heights[index]);
    });
  }, [rowHeights]);
  useLayoutEffect(() => {
    if (!useColumnWindow) return;
    const keys = columns.map((column) => column.key);
    const added = previousColumns.current.length
      ? keys.find((key) => !previousColumns.current.includes(key))
      : undefined;
    if (added) focusTarget.current = added;
    else if (previousFocus.current !== focusedColumn)
      focusTarget.current = focusedColumn;
    previousColumns.current = keys;
    previousFocus.current = focusedColumn;
    const node = viewportRef.current;
    const index = keys.indexOf(focusTarget.current ?? "");
    if (
      !node ||
      index < frozenCount ||
      measuredWidths.length !== columns.length
    )
      return;
    const left = measuredWidths
      .slice(0, index)
      .reduce((sum, width) => sum + width, 0);
    const frozenWidth = measuredWidths
      .slice(0, frozenCount)
      .reduce((sum, width) => sum + width, 0);
    if (
      left < node.scrollLeft + frozenWidth ||
      left + measuredWidths[index] > node.scrollLeft + node.clientWidth
    ) {
      preserveRowHeights();
      node.scrollLeft = Math.max(0, left - frozenWidth);
    }
    setViewport({ left: node.scrollLeft, width: node.clientWidth });
    focusTarget.current = undefined;
  }, [
    columns,
    measuredWidths,
    frozenCount,
    focusedColumn,
    useColumnWindow,
    preserveRowHeights,
  ]);
  const setRoot = useCallback(
    (node: HTMLDivElement | null) => {
      viewportRef.current = node;
      rootRef(node);
    },
    [rootRef],
  );
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node || !useColumnWindow) return;
    let frame = 0;
    let previousLeft = node.scrollLeft;
    const update = () => {
      frame = 0;
      const next = { left: node.scrollLeft, width: node.clientWidth };
      if (next.left !== previousLeft) preserveRowHeights();
      previousLeft = next.left;
      setViewport((previous) =>
        previous.left === next.left && previous.width === next.width
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    node.addEventListener("scroll", schedule, { passive: true });
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(schedule)
        : null;
    observer?.observe(node);
    return () => {
      node.removeEventListener("scroll", schedule);
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [useColumnWindow, preserveRowHeights]);
  useLayoutEffect(() => {
    const table = tableRef.current;
    const measurements = measurementsRef.current;
    if (!table || !measurements) return;
    let disposed = false;
    const samples = [...measurements.children] as HTMLElement[];
    const measure = (fontsChanged = false) => {
      if (disposed) return;
      prepareTextWidthSamples(measurements, fontsChanged);
      const widths = samples.map((sample) => ({
        index: sample.dataset.column,
        width: Math.ceil(sample.getBoundingClientRect().width) + 16,
      }));
      for (const { index, width } of widths)
        table.style.setProperty(`--table-column-${index}-width`, `${width}px`);
      if (useColumnWindow) {
        const measured = new Map(
          widths.map(({ index, width }) => [Number(index), width]),
        );
        const next = columns.map(
          (column, index) =>
            measured.get(index) ??
            (typeof column.width === "number" ? column.width : 120),
        );
        setMeasuredWidths((previous) =>
          previous.length === next.length &&
          previous.every((width, index) => width === next[index])
            ? previous
            : next,
        );
      }
      if (fitWidth) {
        const measured = new Map(
          widths.map(({ index, width }) => [Number(index), width]),
        );
        const total = columns.reduce(
          (sum, column, index) =>
            sum +
            (measured.get(index) ??
              (typeof column.width === "number" ? column.width : 120)),
          0,
        );
        table.style.setProperty("--table-content-width", `${total}px`);
      }
    };
    measure();
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(() => measure())
        : null;
    samples.forEach((sample) => observer?.observe(sample));
    const fontsLoaded = () => measure(true);
    document.fonts?.addEventListener("loadingdone", fontsLoaded);
    return () => {
      disposed = true;
      observer?.disconnect();
      document.fonts?.removeEventListener("loadingdone", fontsLoaded);
    };
  }, [columns, items.length, fitWidth, useColumnWindow]);
  if (!items.length) return empty ?? null;
  return (
    <div
      ref={setRoot}
      data-infinite-list=""
      data-column-window={useColumnWindow || undefined}
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
                <div className={styles.measureHeader}>
                  {column.headerWidthSample ?? column.header}
                </div>
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
        frozenCount={frozenCount}
        onFrozenCountChange={setLocalFrozenCount}
        freezeControls={controlledFrozenCount === undefined}
        className={styles.table}
        style={{
          minWidth: fitWidth ? 0 : minWidth,
          width: fitWidth
            ? "var(--table-content-width, max-content)"
            : undefined,
        }}
        aria-label={label}
        aria-colcount={useColumnWindow ? columns.length : undefined}
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
            {useColumnWindow
              ? columnRanges.map((range) =>
                  range.hidden ? (
                    <th
                      key={`gap:${range.start}`}
                      colSpan={range.end - range.start}
                      aria-hidden="true"
                      data-column-gap=""
                    />
                  ) : (
                    columns
                      .slice(range.start, range.end)
                      .map((column, offset) => (
                        <TableHeaderCell
                          key={column.key}
                          scope="col"
                          {...column.headerProps}
                          aria-colindex={range.start + offset + 1}
                        >
                          {column.header}
                        </TableHeaderCell>
                      ))
                  ),
                )
              : headerGroups.map(({ column, span }) =>
                  column.headerGroup ? (
                    <TableHeaderCell
                      key={column.key}
                      scope="colgroup"
                      colSpan={span}
                      data-table-header-group={column.headerGroup.key}
                    >
                      {column.headerGroup.label}
                    </TableHeaderCell>
                  ) : (
                    <TableHeaderCell
                      key={column.key}
                      scope="col"
                      rowSpan={hasHeaderGroups ? 2 : undefined}
                      {...column.headerProps}
                    >
                      {column.header}
                    </TableHeaderCell>
                  ),
                )}
          </tr>
          {hasHeaderGroups && (
            <tr>
              {columns
                .filter((column) => column.headerGroup)
                .map((column) => (
                  <TableHeaderCell
                    key={column.key}
                    scope="col"
                    {...column.headerProps}
                  >
                    {column.header}
                  </TableHeaderCell>
                ))}
            </tr>
          )}
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
            columnRanges={columnRanges}
            frozenCount={frozenCount}
            rowHeights={useColumnWindow ? rowHeights : undefined}
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
  columnRanges,
  frozenCount,
  rowHeights,
}: Pick<
  Parameters<typeof GroupedTable<Row, Group>>[0],
  "columns" | "rowKey" | "rowProps" | "groupProps"
> & {
  chunk: InfiniteListChunk<TableBlock<Row, Group>>;
  chunkRef: (id: string, node: HTMLElement | null) => void;
  columnRanges: ColumnRange[];
  frozenCount: number;
  rowHeights?: Map<string, number>;
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
          block.rows.map(({ row, group, index, spans: preparedSpans }) => {
            const spans =
              preparedSpans ??
              tableCellSpans([
                columns.map((column, columnIndex) => {
                  const key = column.mergeKey?.(row, group, index);
                  return key === undefined
                    ? undefined
                    : `${columnIndex < frozenCount ? "frozen" : "flow"}:${key}`;
                }),
              ])[0];
            return (
              <TableBodyRow
                {...(index === 0 ? groupProps?.(group) : {})}
                {...rowProps?.(row, group, index)}
                key={`${group.key}:${rowKey(row)}`}
                heightKey={`${group.key}:${rowKey(row)}`}
                rowHeights={rowHeights}
                data-table-group={group.key}
                data-infinite-list-item=""
              >
                {columnRanges.flatMap((range) => {
                  if (range.hidden)
                    return (
                      <td
                        key={`gap:${range.start}`}
                        colSpan={range.end - range.start}
                        aria-hidden="true"
                        data-column-gap=""
                      />
                    );
                  const cells: ReactNode[] = [];
                  let columnIndex = range.start;
                  while (columnIndex < range.end) {
                    let origin = columnIndex;
                    // A horizontal merge may begin outside this visible range.
                    while (origin > 0 && !spans[origin]) origin--;
                    const originalSpan = spans[origin];
                    if (!originalSpan) {
                      columnIndex++;
                      continue;
                    }
                    // Ordinary tables may contain rowSpan holes, which must remain absent.
                    if (preparedSpans && !spans[columnIndex]) {
                      columnIndex++;
                      continue;
                    }
                    const span = {
                      ...originalSpan,
                      colSpan:
                        Math.min(origin + originalSpan.colSpan, range.end) -
                        columnIndex,
                    };
                    const column = columns[origin];
                    // Preserve column markers when before/after cells become one cell.
                    const props = Object.assign(
                      {},
                      ...columns
                        .slice(columnIndex, columnIndex + span.colSpan)
                        .map((c) => c.cellProps?.(row)),
                    );
                    cells.push(
                      <TableCell
                        {...props}
                        key={`${column.key}:${columnIndex}`}
                        as={column.merged ? "th" : "td"}
                        scope={column.merged ? "row" : undefined}
                        rowSpan={span.rowSpan}
                        colSpan={span.colSpan}
                        className={column.className}
                        data-table-column={column.key}
                        aria-colindex={columnIndex + 1}
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
                      </TableCell>,
                    );
                    columnIndex += span.colSpan;
                  }
                  return cells;
                })}
              </TableBodyRow>
            );
          }),
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

function TableBodyRow({
  heightKey,
  rowHeights,
  style,
  ...props
}: ComponentProps<"tr"> & {
  heightKey: string;
  rowHeights?: Map<string, number>;
}) {
  const naturalHeight = style?.height;
  const restoreHeight = useCallback(
    (node: HTMLTableRowElement | null) => {
      if (!node || !rowHeights) return;
      const height = rowHeights.get(heightKey);
      node.style.height = height
        ? `${height}px`
        : typeof naturalHeight === "number"
          ? `${naturalHeight}px`
          : (naturalHeight ?? "");
      return () => {
        rowHeights.set(
          heightKey,
          Math.max(
            rowHeights.get(heightKey) ?? 0,
            Math.ceil(node.getBoundingClientRect().height),
          ),
        );
      };
    },
    [heightKey, rowHeights, naturalHeight],
  );
  return (
    <tr
      {...props}
      style={style}
      ref={restoreHeight}
      data-height-key={heightKey}
    />
  );
}
