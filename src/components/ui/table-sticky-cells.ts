type MergedCell = {
  cell: HTMLTableCellElement;
  slot: HTMLElement;
  content: HTMLElement;
  top: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
  header: boolean;
};

/** Keep the original content fixed while pinned; only layout changes measure cells. */
export function attachTableStickyCells(table: HTMLTableElement) {
  const cells = new Map<HTMLElement, MergedCell>();
  let frame = 0;
  let dirty = true;
  let refreshNeeded = true;
  let listening = false;
  let ancestors: HTMLElement[] = [];
  let paddingTop = 0;
  let headerHeight = 0;
  let headerOffset = 0;
  let hasHeaders = false;
  const set = (element: HTMLElement, name: string, value: string) => {
    if (element.style.getPropertyValue(name) !== value)
      element.style.setProperty(name, value);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const invalidate = () => {
    dirty = true;
    schedule();
  };
  const resize =
    typeof ResizeObserver === "undefined"
      ? undefined
      : new ResizeObserver(invalidate);
  const refresh = () => {
    refreshNeeded = false;
    const contents = new Set(
      table.querySelectorAll<HTMLElement>(
        "[data-table-merged-content], [data-table-header-content]",
      ),
    );
    for (const [content, entry] of cells) {
      if (contents.has(content)) continue;
      resize?.unobserve(entry.cell);
      resize?.unobserve(entry.slot);
      resize?.unobserve(content);
      cells.delete(content);
    }
    for (const content of contents) {
      if (cells.has(content)) continue;
      const slot = content.parentElement;
      const cell = slot?.parentElement;
      if (
        !(cell instanceof HTMLTableCellElement) ||
        cell.closest("table") !== table ||
        !slot
      )
        continue;
      cells.set(content, {
        cell,
        slot,
        content,
        top: 0,
        bottom: 0,
        left: 0,
        width: 0,
        height: 0,
        header: content.hasAttribute("data-table-header-content"),
      });
      resize?.observe(cell);
      resize?.observe(slot);
      resize?.observe(content);
    }
    hasHeaders = [...cells.values()].some((entry) => entry.header);
    if (cells.size && !listening) {
      ancestors = [];
      for (
        let parent = table.parentElement;
        parent && parent !== document.body;
        parent = parent.parentElement
      ) {
        if (
          /(auto|scroll|hidden|clip)/u.test(getComputedStyle(parent).overflowY)
        ) {
          ancestors.push(parent);
          resize?.observe(parent);
        }
      }
      resize?.observe(table);
      if (table.tHead) resize?.observe(table.tHead);
      document.addEventListener("scroll", schedule, {
        capture: true,
        passive: true,
      });
      window.addEventListener("resize", invalidate, { passive: true });
      listening = true;
    }
    if (!cells.size && listening) {
      resize?.disconnect();
      document.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", invalidate);
      listening = false;
    }
    dirty = true;
  };
  function update() {
    frame = 0;
    if (refreshNeeded) refresh();
    if (!cells.size) return;
    const tableRect = table.getBoundingClientRect();
    if (dirty) {
      paddingTop =
        parseFloat(
          getComputedStyle(document.documentElement).scrollPaddingTop,
        ) || 0;
      const head = table.tHead?.getBoundingClientRect();
      headerHeight = head?.height ?? 0;
      headerOffset = (head?.top ?? tableRect.top) - tableRect.top;
      for (const entry of cells.values()) {
        const bounds = entry.cell.getBoundingClientRect();
        const slot = entry.slot.getBoundingClientRect();
        const css = getComputedStyle(entry.cell);
        entry.top = slot.top - tableRect.top;
        entry.bottom =
          bounds.bottom -
          (parseFloat(css.borderBottomWidth) || 0) -
          (parseFloat(css.paddingBottom) || 0) -
          tableRect.top;
        entry.left = slot.left - tableRect.left;
        entry.width = slot.width;
        entry.height = entry.content.getBoundingClientRect().height;
      }
      if (hasHeaders) {
        const headers = [...cells.values()].filter((entry) => entry.header);
        headerOffset = Math.min(...headers.map((entry) => entry.top));
        headerHeight =
          Math.max(...headers.map((entry) => entry.top + entry.height)) -
          headerOffset;
      }
      dirty = false;
    }
    let top = paddingTop;
    let left = 0;
    let right = window.innerWidth;
    let bottom = window.innerHeight;
    for (const parent of ancestors) {
      const bounds = parent.getBoundingClientRect();
      top = Math.max(top, bounds.top + parent.clientTop);
      left = Math.max(left, bounds.left + parent.clientLeft);
      right = Math.min(
        right,
        bounds.left + parent.clientLeft + parent.clientWidth,
      );
      bottom = Math.min(
        bottom,
        bounds.top + parent.clientTop + parent.clientHeight,
      );
    }
    const headerTop = Math.min(
      Math.max(top, tableRect.top + headerOffset),
      tableRect.bottom - headerHeight,
    );
    const headBottom = hasHeaders
      ? headerTop + headerHeight
      : (table.tHead?.getBoundingClientRect().bottom ?? top);
    const pinTop = Math.max(top, headBottom) + 4;
    // All geometry reads precede writes. Scrolling only reads table/viewport bounds,
    // regardless of how many virtual groups are mounted.
    for (const entry of cells.values()) {
      const { content, slot, height } = entry;
      const origin = tableRect.top + entry.top;
      const limit = Math.max(0, entry.bottom - entry.top - height);
      const target = entry.header
        ? headerTop + entry.top - headerOffset
        : pinTop;
      const offset = entry.header
        ? Math.max(0, target - origin)
        : Math.max(0, Math.min(target - origin, limit));
      const pinned =
        offset > 0 && (entry.header || offset < limit) && target < bottom;
      if (pinned) {
        const x = tableRect.left + entry.left;
        set(slot, "height", `${height}px`);
        set(content, "--table-cell-top", `${target}px`);
        set(content, "--table-cell-left", `${x}px`);
        set(content, "--table-cell-width", `${entry.width}px`);
        set(
          content,
          "--table-cell-clip",
          `inset(0px ${Math.max(0, x + entry.width - right)}px ${Math.max(0, target + height - bottom)}px ${Math.max(0, left - x)}px)`,
        );
        if (!content.hasAttribute("data-table-pinned"))
          content.setAttribute("data-table-pinned", "");
      } else {
        content.removeAttribute("data-table-pinned");
        slot.style.removeProperty("height");
        set(content, "--table-cell-offset", `${offset}px`);
      }
    }
  }
  const mutation = new MutationObserver(() => {
    refreshNeeded = true;
    if (
      cells.size ||
      table.querySelector(
        "[data-table-merged-content], [data-table-header-content]",
      )
    )
      invalidate();
  });
  mutation.observe(table, { childList: true, subtree: true });
  refresh();
  if (cells.size) schedule();
  return () => {
    mutation.disconnect();
    resize?.disconnect();
    document.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", invalidate);
    cancelAnimationFrame(frame);
    for (const { content, slot } of cells.values()) {
      content.removeAttribute("data-table-pinned");
      for (const name of ["offset", "top", "left", "width", "clip"])
        content.style.removeProperty(`--table-cell-${name}`);
      slot.style.removeProperty("height");
    }
  };
}
