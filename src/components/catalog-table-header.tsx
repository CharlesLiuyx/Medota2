"use client";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ArrowUpDown, Ellipsis } from "lucide-react";
import { useTranslations } from "@/i18n/provider";
import { CompactSelect } from "./ui/compact-select";
import styles from "./catalog-table-header.module.css";

export function CatalogTableHeader({
  columnKey,
  name,
  active,
  direction,
  ready,
  numeric,
  frozen,
  onFreeze,
  onUnfreeze,
  decimals,
  canMoveLeft,
  canMoveRight,
  onSort,
  onHide,
  onMove,
  onReorder,
  onDecimals,
}: {
  columnKey: string;
  name: string;
  active: boolean;
  direction: "asc" | "desc";
  ready: boolean;
  numeric: boolean;
  frozen: boolean;
  onFreeze: () => void;
  onUnfreeze: () => void;
  decimals?: number;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onSort: (direction: "asc" | "desc") => void;
  onHide: () => void;
  onMove: (offset: number) => void;
  onReorder: (target: string, after: boolean) => void;
  onDecimals: (digits: number | undefined) => void;
}) {
  const t = useTranslations();
  const [menu, setMenu] = useState<{ top: number; left: number }>();
  const menuRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{
    timer: ReturnType<typeof setTimeout>;
    x: number;
    y: number;
    active: boolean;
    ghost?: HTMLDivElement;
    target?: HTMLElement;
    after: boolean;
    capture: HTMLElement;
  }>(null);
  const suppressClick = useRef(false);
  const close = () => {
    setMenu(undefined);
    moreRef.current?.focus();
  };
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: globalThis.PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        !moreRef.current?.contains(event.target as Node)
      )
        setMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        setMenu(undefined);
        moreRef.current?.focus();
      }
      if (
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        !(event.target as HTMLElement).closest("[data-filter-menu], input")
      ) {
        event.preventDefault();
        const controls = [
          ...(menuRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input,[role=combobox]",
          ) ?? []),
        ];
        const index = controls.indexOf(document.activeElement as HTMLElement);
        controls[
          (index + (event.key === "ArrowDown" ? 1 : -1) + controls.length) %
            controls.length
        ]?.focus();
      }
    };
    const moved = (event: Event) => {
      if (
        event.target instanceof Node &&
        menuRef.current?.contains(event.target)
      )
        return;
      setMenu(undefined);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", moved);
    window.addEventListener("scroll", moved, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", moved);
      window.removeEventListener("scroll", moved, true);
    };
  }, [menu]);
  useEffect(
    () => () => {
      if (drag.current) {
        clearTimeout(drag.current.timer);
        drag.current.ghost?.remove();
        drag.current.target?.removeAttribute("data-column-drop");
      }
    },
    [],
  );
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0 ||
      !ready ||
      !event.currentTarget.contains(event.target as Node)
    )
      return;
    pressRef.current?.setAttribute("data-pressing", "");
    const element =
      (event.target as HTMLElement).closest("button") ?? event.currentTarget;
    const x = event.clientX,
      y = event.clientY;
    suppressClick.current = false;
    element.setPointerCapture(event.pointerId);
    const timer = setTimeout(() => {
      if (!drag.current) return;
      const ghost = document.createElement("div");
      ghost.className = styles.ghost;
      ghost.textContent = name;
      ghost.style.left = `${x + 12}px`;
      ghost.style.top = `${y + 12}px`;
      document.body.append(ghost);
      pressRef.current?.setAttribute("data-dragging", "");
      drag.current.active = true;
      drag.current.ghost = ghost;
      suppressClick.current = true;
    }, 180);
    drag.current = {
      timer,
      x,
      y,
      active: false,
      after: false,
      capture: element,
    };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    if (!state.active) {
      if (Math.hypot(event.clientX - state.x, event.clientY - state.y) > 8) {
        clearTimeout(state.timer);
        pressRef.current?.removeAttribute("data-pressing");
        if (state.capture.hasPointerCapture(event.pointerId))
          state.capture.releasePointerCapture(event.pointerId);
        drag.current = null;
      }
      return;
    }
    event.preventDefault();
    if (state.ghost) {
      state.ghost.style.left = `${event.clientX + 12}px`;
      state.ghost.style.top = `${event.clientY + 12}px`;
    }
    const table = event.currentTarget.closest("table");
    const headers =
      table?.querySelectorAll<HTMLElement>("thead th[data-catalog-column]") ??
      [];
    const target = [...headers].find((header) => {
      const box = header.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX < box.right;
    });
    state.target?.removeAttribute("data-column-drop");
    state.target = target;
    if (target) {
      const box = target.getBoundingClientRect();
      state.after = event.clientX >= box.left + box.width / 2;
      target.setAttribute("data-column-drop", state.after ? "after" : "before");
    }
    // The existing table scroll container remains usable when dragging past its edge.
    let scroll = table?.parentElement;
    while (scroll && scroll.scrollWidth <= scroll.clientWidth)
      scroll = scroll.parentElement;
    if (scroll) {
      const box = scroll.getBoundingClientRect();
      if (event.clientX > box.right - 32) scroll.scrollLeft += 24;
      else if (event.clientX < box.left + 32) scroll.scrollLeft -= 24;
    }
  };
  const finish = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    pressRef.current?.removeAttribute("data-pressing");
    pressRef.current?.removeAttribute("data-dragging");
    const state = drag.current;
    if (!state) return;
    clearTimeout(state.timer);
    state.ghost?.remove();
    state.target?.removeAttribute("data-column-drop");
    const target = state.target?.dataset.catalogColumn;
    drag.current = null;
    if (state.capture.hasPointerCapture(event.pointerId))
      state.capture.releasePointerCapture(event.pointerId);
    if (!cancelled && state.active && target && target !== columnKey)
      onReorder(target, state.after);
  };
  const Icon = active
    ? direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  return (
    <div
      ref={pressRef}
      className={styles.header}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={(event) => finish(event)}
      onPointerCancel={(event) => finish(event, true)}
      onLostPointerCapture={(event) => finish(event, true)}
    >
      <button
        type="button"
        disabled={!ready}
        className={styles.sort}
        title={t("长按拖动可调整列顺序")}
        aria-label={t("按{name}{direction}排序", {
          name,
          direction: active && direction === "asc" ? t("降序") : t("升序"),
        })}
        onClick={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            suppressClick.current = false;
            return;
          }
          onSort(active && direction === "asc" ? "desc" : "asc");
        }}
      >
        <span>{name}</span>
        <Icon
          aria-hidden
          className={`size-3 shrink-0 ${active ? "" : "opacity-40"}`}
        />
      </button>
      <button
        type="button"
        ref={moreRef}
        className={styles.more}
        aria-label={t("配置{name}列", { name })}
        aria-expanded={Boolean(menu)}
        aria-haspopup="dialog"
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (menu) {
            setMenu(undefined);
            return;
          }
          const box = moreRef.current!.getBoundingClientRect();
          setMenu({
            top: Math.max(
              8,
              Math.min(box.bottom + 5, window.innerHeight - 410),
            ),
            left: Math.max(8, Math.min(box.left, window.innerWidth - 228)),
          });
        }}
      >
        <Ellipsis aria-hidden className="size-3.5" />
      </button>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label={t("配置{name}列", { name })}
            className={styles.menu}
            style={menu}
          >
            <strong className="block truncate px-2 py-1 text-[var(--text-secondary)]">
              {name}
            </strong>
            <button
              disabled={!ready}
              onClick={() => {
                onSort("asc");
                close();
              }}
            >
              {t("升序")}
            </button>
            <button
              disabled={!ready}
              onClick={() => {
                onSort("desc");
                close();
              }}
            >
              {t("降序")}
            </button>
            <button
              disabled={!canMoveLeft}
              onClick={() => {
                onMove(-1);
                close();
              }}
            >
              {t("向左移动")}
            </button>
            <button
              disabled={!canMoveRight}
              onClick={() => {
                onMove(1);
                close();
              }}
            >
              {t("向右移动")}
            </button>
            <button
              disabled={columnKey === "entity"}
              onClick={() => {
                onHide();
                close();
              }}
            >
              {t("隐藏此列")}
            </button>
            <button
              onClick={() => {
                if (frozen) onUnfreeze();
                else onFreeze();
                close();
              }}
            >
              {t(frozen ? "取消冻结" : "冻结至此列")}
            </button>
            {numeric && (
              <div className="mt-1 border-t border-white/10 px-2 pt-2">
                <div className="flex items-center justify-between gap-2">
                  {t("小数位数")}
                  <CompactSelect
                    value={decimals ?? "auto"}
                    label={t("小数位数")}
                    hideLabel
                    onValueChange={(value) =>
                      onDecimals(value === "auto" ? undefined : Number(value))
                    }
                  >
                    <option value="auto">{t("自动")}</option>
                    {Array.from({ length: 11 }, (_, digits) => (
                      <option key={digits} value={digits}>
                        {digits}
                      </option>
                    ))}
                  </CompactSelect>
                </div>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  {t("仅调整数字显示，排序使用原始数值。")}
                </p>
                <button onClick={() => onDecimals(undefined)}>
                  {t("恢复默认小数位数")}
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
