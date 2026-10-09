import type { Camera } from "@/domain/map/geometry";
import type { NavGrid } from "@/domain/map/routing";

const TILE_CELLS = 32;
type Segment = [number, number, number, number];
type Tile = {
  col: number;
  row: number;
  cells: [number, number][];
  edges: Segment[];
  fill: Path2D | null;
  outline: Path2D | null;
};

/** Compile immutable occupancy once, retaining cross-tile adjacency at boundaries. */
export function prepareGridPaint(
  grid: Pick<NavGrid, "width">,
  cells: readonly number[],
) {
  const occupied = new Set(cells);
  const tiles = new Map<string, Tile>();
  for (const index of occupied) {
    const x = index % grid.width,
      y = Math.floor(index / grid.width);
    const col = Math.floor(x / TILE_CELLS),
      row = Math.floor(y / TILE_CELLS);
    const key = `${col}:${row}`;
    let tile = tiles.get(key);
    if (!tile) {
      tile = {
        col,
        row,
        cells: [],
        edges: [],
        fill: typeof Path2D === "undefined" ? null : new Path2D(),
        outline: typeof Path2D === "undefined" ? null : new Path2D(),
      };
      tiles.set(key, tile);
    }
    tile.cells.push([x, y]);
    tile.fill?.rect(x, y, 1, 1);
    const edge = (...line: Segment) => {
      tile!.edges.push(line);
      tile!.outline?.moveTo(line[0], line[1]);
      tile!.outline?.lineTo(line[2], line[3]);
    };
    if (x === 0 || !occupied.has(index - 1)) edge(x, y, x, y + 1);
    if (x === grid.width - 1 || !occupied.has(index + 1))
      edge(x + 1, y, x + 1, y + 1);
    if (!occupied.has(index - grid.width)) edge(x, y, x + 1, y);
    if (!occupied.has(index + grid.width)) edge(x, y + 1, x + 1, y + 1);
  }
  return tiles;
}

/** Replay only visible cached tiles. Line widths remain fixed in CSS pixels. */
export function paintGrid(
  ctx: CanvasRenderingContext2D,
  tiles: ReturnType<typeof prepareGridPaint>,
  grid: Pick<NavGrid, "x" | "y" | "cell">,
  camera: Camera,
  viewport: { width: number; height: number; scale: number; dpr: number },
  style: {
    fill: string;
    border: string;
    width?: number;
    inner?: string;
    innerAlpha?: number;
  },
) {
  const { width, height, scale, dpr } = viewport;
  const unit = scale * camera.zoom,
    side = unit * grid.cell;
  const tx = width / 2 + (grid.x - camera.x) * unit;
  const ty = height / 2 - (grid.y - camera.y) * unit;
  const minCol = Math.floor(-tx / side / TILE_CELLS),
    maxCol = Math.floor((width - tx) / side / TILE_CELLS);
  const minRow = Math.floor((ty - height) / side / TILE_CELLS),
    maxRow = Math.floor(ty / side / TILE_CELLS);
  let drawn = 0;
  ctx.save();
  for (let row = minRow; row <= maxRow; row++)
    for (let col = minCol; col <= maxCol; col++) {
      const tile = tiles.get(`${col}:${row}`);
      if (!tile) continue;
      drawn++;
      ctx.fillStyle = style.fill;
      ctx.strokeStyle = style.inner ?? style.border;
      if (tile.fill && tile.outline) {
        ctx.setTransform(dpr * side, 0, 0, -dpr * side, dpr * tx, dpr * ty);
        ctx.lineWidth = (style.width ?? 0.35) / side;
        ctx.fill(tile.fill);
        ctx.globalAlpha = style.innerAlpha ?? 0.2;
        ctx.stroke(tile.fill);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = style.border;
        ctx.stroke(tile.outline);
      } else {
        // Canvas-only environments retain equivalent geometry without Path2D.
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineWidth = style.width ?? 0.35;
        ctx.beginPath();
        for (const [x, y] of tile.cells)
          ctx.rect(tx + x * side, ty - (y + 1) * side, side, side);
        ctx.fill();
        ctx.globalAlpha = style.innerAlpha ?? 0.2;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = style.border;
        ctx.beginPath();
        for (const [x1, y1, x2, y2] of tile.edges) {
          ctx.moveTo(tx + x1 * side, ty - y1 * side);
          ctx.lineTo(tx + x2 * side, ty - y2 * side);
        }
        ctx.stroke();
      }
    }
  ctx.restore();
  return drawn;
}
