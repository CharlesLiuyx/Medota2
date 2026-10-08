/** A key describes the complete displayed content, including link/tooltip behavior. */
export type CellSpan = { rowSpan: number; colSpan: number };

/** Partition equal neighbors into rectangles. Non-rectangular regions retain all cells. */
export function tableCellSpans(
  keys: readonly (readonly (string | undefined)[])[],
  verticalFirst: readonly boolean[] = [],
) {
  const spans: (CellSpan | null)[][] = keys.map((row) => row.map(() => null));
  const occupied = keys.map((row) => row.map(() => false));
  for (let r = 0; r < keys.length; r++) {
    for (let c = 0; c < keys[r].length; c++) {
      if (occupied[r][c]) continue;
      const key = keys[r][c];
      let width = 1,
        height = 1;
      const equal = (y: number, x: number) =>
        key !== undefined && !occupied[y][x] && keys[y][x] === key;
      if (verticalFirst[c]) {
        while (r + height < keys.length && equal(r + height, c)) height++;
        while (
          c + width < keys[r].length &&
          Array.from({ length: height }, (_, i) =>
            equal(r + i, c + width),
          ).every(Boolean)
        )
          width++;
      } else {
        while (c + width < keys[r].length && equal(r, c + width)) width++;
        while (
          r + height < keys.length &&
          Array.from({ length: width }, (_, i) =>
            equal(r + height, c + i),
          ).every(Boolean)
        )
          height++;
      }
      spans[r][c] = { rowSpan: height, colSpan: width };
      for (let y = r; y < r + height; y++)
        for (let x = c; x < c + width; x++) occupied[y][x] = true;
    }
  }
  return spans;
}
