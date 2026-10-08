// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  GroupedTable,
  type GroupedTableColumn,
} from "@/components/ui/grouped-table";
import { DataTable, TableCell } from "@/components/ui/data-table";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) {
        if (target.hasAttribute("data-infinite-boundary"))
          queueMicrotask(() =>
            this.callback(
              [{ target, isIntersecting: true } as IntersectionObserverEntry],
              this as unknown as IntersectionObserver,
            ),
          );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
  vi.stubGlobal("scrollBy", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("renders multiple arbitrary items and property rows, then rebuilds merged cells after filtering", async () => {
  type Row = { key: string; value: number };
  type Group = { key: string; name: string; rows: Row[] };
  const groups: Group[] = [
    {
      key: "a",
      name: "Item A",
      rows: [
        { key: "weight", value: 10 },
        { key: "cost", value: 20 },
      ],
    },
    {
      key: "b",
      name: "Item B",
      rows: [
        { key: "weight", value: 30 },
        { key: "cost", value: 40 },
        { key: "stock", value: 50 },
      ],
    },
    { key: "empty", name: "Empty item", rows: [] },
  ];
  const columns: GroupedTableColumn<Group, Row>[] = [
    {
      key: "item",
      header: "Item",
      merged: true,
      render: (_row, group) => group.name,
    },
    { key: "property", header: "Property", render: (row) => row.key },
    { key: "value", header: "Value", render: (row) => row.value },
  ];
  const props = {
    columns,
    label: "Item properties",
    rowKey: (row: Row) => row.key,
  };
  const { rerender } = render(
    <GroupedTable {...props} groups={groups} identity="all" />,
  );
  await waitFor(() => expect(screen.getAllByRole("rowheader")).toHaveLength(2));
  const table = screen.getByRole("table", { name: "Item properties" });
  expect(
    screen.getByRole("rowheader", { name: "Item A" }).getAttribute("rowspan"),
  ).toBe("2");
  expect(
    screen.getByRole("rowheader", { name: "Item B" }).getAttribute("rowspan"),
  ).toBe("3");
  expect(table.querySelectorAll("[data-infinite-list-item]")).toHaveLength(5);
  expect(table.querySelectorAll("[data-table-merged-content]")).toHaveLength(2);
  expect(screen.queryByText("Empty item")).toBeNull();
  rerender(
    <GroupedTable {...props} groups={[groups[1]]} identity="filtered" />,
  );
  await waitFor(() => expect(screen.queryByText("Item A")).toBeNull());
  expect(table.querySelectorAll("[data-infinite-list-item]")).toHaveLength(3);
  expect(table.querySelectorAll("[data-table-merged-content]")).toHaveLength(1);
});

it("applies the same merged-cell contract to plain tables, including span-to-end cells", () => {
  const { container } = render(
    <DataTable aria-label="Plain table">
      <tbody>
        <tr>
          <TableCell as="th" scope="rowgroup" rowSpan={0}>
            Group
          </TableCell>
          <TableCell>First property</TableCell>
        </tr>
        <tr>
          <TableCell>Second property</TableCell>
        </tr>
      </tbody>
    </DataTable>,
  );
  expect(screen.getByRole("rowheader").getAttribute("rowspan")).toBe("0");
  expect(
    container.querySelectorAll("[data-table-merged-content]"),
  ).toHaveLength(1);
  expect(screen.getAllByRole("cell")).toHaveLength(2);
});

it("merges identical values horizontally and across groups without splitting their virtual block", async () => {
  type Row = { key: string; before: string; after: string; target: string };
  type Group = { key: string; rows: Row[] };
  const groups: Group[] = [
    {
      key: "a",
      rows: [
        { key: "unchanged", before: "10", after: "10", target: "first" },
        { key: "changed", before: "20", after: "30", target: "second" },
      ],
    },
    {
      key: "b",
      rows: [{ key: "changed", before: "20", after: "40", target: "third" }],
    },
  ];
  const columns: GroupedTableColumn<Group, Row>[] = [
    {
      key: "owner",
      header: "Owner",
      merged: true,
      render: (_row, group) => group.key,
    },
    {
      key: "before",
      header: "Before",
      mergeKey: (row) => row.before,
      render: (row) => row.before,
    },
    {
      key: "after",
      header: "After",
      mergeKey: (row) => row.after,
      render: (row) => row.after,
    },
    {
      key: "source",
      header: "Source",
      mergeKey: (row) => row.target,
      render: () => "Source",
    },
  ];
  const props = {
    columns,
    rowKey: (row: Row) => row.key,
    label: "Merged values",
  };
  const { rerender } = render(
    <GroupedTable {...props} groups={groups} identity="all-values" />,
  );
  await waitFor(() => expect(screen.getAllByRole("rowheader")).toHaveLength(2));
  const table = screen.getByRole("table");
  expect(screen.getByRole("cell", { name: "10" }).getAttribute("colspan")).toBe(
    "2",
  );
  expect(screen.getByRole("cell", { name: "20" }).getAttribute("rowspan")).toBe(
    "2",
  );
  expect(screen.getAllByRole("cell", { name: "Source" })).toHaveLength(3);
  expect(table.querySelectorAll("[data-infinite-list-chunk]")).toHaveLength(1);
  expect(table.querySelectorAll("[data-infinite-list-item]")).toHaveLength(3);
  rerender(<GroupedTable {...props} groups={[groups[1]]} identity="only-b" />);
  await waitFor(() =>
    expect(screen.queryByRole("cell", { name: "10" })).toBeNull(),
  );
  expect(screen.getByRole("cell", { name: "20" }).getAttribute("rowspan")).toBe(
    "1",
  );
});

it("partitions non-rectangular equal regions without dropping or overlapping values", async () => {
  const { tableCellSpans } = await import("@/components/ui/table-cell-spans");
  expect(
    tableCellSpans([
      ["same", "same"],
      ["same", "different"],
    ]),
  ).toEqual([
    [{ rowSpan: 1, colSpan: 2 }, null],
    [
      { rowSpan: 1, colSpan: 1 },
      { rowSpan: 1, colSpan: 1 },
    ],
  ]);
  expect(
    tableCellSpans(
      [
        ["same", "same"],
        ["same", "different"],
      ],
      [true],
    ),
  ).toEqual([
    [
      { rowSpan: 2, colSpan: 1 },
      { rowSpan: 1, colSpan: 1 },
    ],
    [null, { rowSpan: 1, colSpan: 1 }],
  ]);
});
