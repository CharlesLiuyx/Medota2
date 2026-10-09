import { afterEach, expect, it, vi } from "vitest";
import { paintGrid, prepareGridPaint } from "@/components/map/grid-painter";
afterEach(() => vi.unstubAllGlobals());
it("keeps a continuous outline across tile seams without joining opposite row edges", () => {
  const tiles = prepareGridPaint({ width: 64 }, [31, 32]);
  const edges = [...tiles.values()].flatMap((t) => t.edges);
  expect(edges).toHaveLength(6);
  expect(edges.some(([x1, , x2]) => x1 === 32 && x2 === 32)).toBe(false);
  expect(
    [...prepareGridPaint({ width: 64 }, [63, 64]).values()].flatMap(
      (t) => t.edges,
    ),
  ).toHaveLength(8);
});
it("reuses compiled paths across camera changes and submits only visible tiles", () => {
  let built = 0;
  vi.stubGlobal(
    "Path2D",
    class {
      constructor() {
        built++;
      }
      rect() {}
      moveTo() {}
      lineTo() {}
    },
  );
  const tiles = prepareGridPaint({ width: 128 }, [0, 32, 64, 96]);
  expect(built).toBe(8);
  const fill = vi.fn();
  const ctx = new Proxy(
    {},
    { get: (_, k) => (k === "fill" ? fill : () => {}), set: () => true },
  ) as CanvasRenderingContext2D;
  const viewport = { width: 100, height: 100, scale: 1, dpr: 2 };
  const grid = { x: 0, y: 0, cell: 10 };
  const style = { fill: "green", border: "black" };
  expect(
    paintGrid(ctx, tiles, grid, { x: 50, y: 50, zoom: 1 }, viewport, style),
  ).toBe(1);
  expect(fill).toHaveBeenLastCalledWith(tiles.get("0:0")!.fill);
  expect(
    paintGrid(ctx, tiles, grid, { x: 370, y: 50, zoom: 1 }, viewport, style),
  ).toBe(1);
  expect(fill).toHaveBeenLastCalledWith(tiles.get("1:0")!.fill);
  expect(built).toBe(8);
});
