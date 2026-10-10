/** Cache logical positions, including rowSpan holes; scrolling is handled by CSS. */
export function attachTableFrozenColumns(
  table: HTMLTableElement,
  count: number,
) {
  let frame = 0;
  const update = () => {
    frame = 0;
    const headers = [...(table.tHead?.rows[0]?.cells ?? [])];
    const offsets: number[] = [];
    let width = 0;
    for (const header of headers) {
      for (let i = 0; i < header.colSpan; i++) offsets.push(width);
      width += header.getBoundingClientRect().width;
    }
    table.style.setProperty(
      "--table-frozen-width",
      `${count ? (offsets[count] ?? width) : 0}px`,
    );
    for (const section of [table.tHead, ...table.tBodies, table.tFoot]) {
      if (!section) continue;
      const occupied: number[] = [];
      [...section.rows].forEach((row, rowIndex) => {
        let column = 0;
        for (const cell of row.cells) {
          while ((occupied[column] ?? 0) > rowIndex) column++;
          const frozen = column < count && column + cell.colSpan <= count;
          cell.toggleAttribute("data-table-frozen", frozen);
          cell.toggleAttribute(
            "data-table-frozen-edge",
            frozen && column + cell.colSpan === count,
          );
          if (frozen)
            cell.style.setProperty(
              "--table-frozen-left",
              `${offsets[column] ?? 0}px`,
            );
          else cell.style.removeProperty("--table-frozen-left");
          for (let i = 0; i < cell.colSpan; i++)
            occupied[column + i] =
              cell.rowSpan === 0
                ? section.rows.length
                : rowIndex + cell.rowSpan;
          column += cell.colSpan;
        }
      });
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const resize =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
  resize?.observe(table);
  if (table.tHead) resize?.observe(table.tHead);
  const mutations = new MutationObserver(schedule);
  mutations.observe(table, { childList: true, subtree: true });
  update();
  return () => {
    resize?.disconnect();
    mutations.disconnect();
    cancelAnimationFrame(frame);
  };
}
