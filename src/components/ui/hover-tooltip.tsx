"use client";

import {
  createContext,
  useContext,
  useMemo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import Link from "@/components/version-link";

const TooltipAncestors = createContext<readonly string[]>([]);
let activePath: readonly string[] = [];
const elements = new Map<
  string,
  () => { anchor: HTMLElement | null; panel: HTMLElement | null }
>();
let hoverSuppressed = false;
const listeners = new Map<string, Set<() => void>>();
function subscribe(id: string, listener: () => void) {
  let bucket = listeners.get(id);
  if (!bucket) listeners.set(id, (bucket = new Set()));
  bucket.add(listener);
  return () => {
    bucket.delete(listener);
    if (!bucket.size) listeners.delete(id);
  };
}
function setActive(path: readonly string[]) {
  if (activePath.at(-1) === path.at(-1)) return;
  const previous = activePath;
  activePath = path;
  // Only anchors whose visibility changed rerender; open parents remain mounted.
  for (const id of new Set([...previous, ...path])) {
    if (previous.includes(id) === path.includes(id)) continue;
    for (const listener of listeners.get(id) ?? []) listener();
  }
}
const serverSnapshot = () => false;
function close(id: string) {
  const index = activePath.indexOf(id);
  if (index >= 0) setActive(activePath.slice(0, index));
}
function insideBranch(id: string, target: EventTarget | null) {
  if (!(target instanceof Node)) return false;
  const index = activePath.indexOf(id);
  return (
    index >= 0 &&
    activePath.slice(index).some((key) => {
      const nodes = elements.get(key)?.();
      return nodes?.anchor?.contains(target) || nodes?.panel?.contains(target);
    })
  );
}
function closeInactive() {
  for (let index = activePath.length - 1; index >= 0; index--) {
    const nodes = elements.get(activePath[index])?.();
    if (
      [nodes?.anchor, nodes?.panel].some(
        (node) =>
          node?.matches(":hover") || node?.contains(document.activeElement),
      )
    ) {
      setActive(activePath.slice(0, index + 1));
      return;
    }
  }
  setActive([]);
}

/** Opens synchronously; the short exit grace lets the pointer cross into the panel. */
export function HoverTooltip({
  children,
  content,
  href,
  className,
  width,
}: {
  children: ReactNode;
  content: ReactNode;
  href?: string;
  className?: string;
  width?: number;
}) {
  const id = useId();
  const ancestors = useContext(TooltipAncestors);
  const path = useMemo(() => [...ancestors, id], [ancestors, id]);
  const listen = useCallback(
    (listener: () => void) => subscribe(id, listener),
    [id],
  );
  const snapshot = useCallback(() => activePath.includes(id), [id]);
  const open = useSyncExternalStore(listen, snapshot, serverSnapshot);
  const [prefetchReady, setPrefetchReady] = useState(false);
  // Only the active anchor opts into full route prefetch. A short dwell avoids
  // fetching hundreds of detail pages while the pointer crosses a dense grid.
  useEffect(() => {
    if (!href || !open || prefetchReady) return;
    const timer = setTimeout(() => setPrefetchReady(true), 120);
    return () => clearTimeout(timer);
  }, [href, open, prefetchReady]);
  const anchor = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closing.current) clearTimeout(closing.current);
    closing.current = null;
  };
  const hide = () => {
    cancelClose();
    close(id);
  };
  const scheduleClose = () => {
    cancelClose();
    closing.current = setTimeout(closeInactive, 90);
  };
  const show = (element: HTMLElement, pointer = false) => {
    if (pointer && hoverSuppressed) return;
    cancelClose();
    anchor.current = element;
    setActive(path);
  };

  useLayoutEffect(() => {
    elements.set(id, () => ({ anchor: anchor.current, panel: panel.current }));
    return () => {
      if (closing.current) clearTimeout(closing.current);
      close(id);
      elements.delete(id);
    };
  }, [id]);

  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const position = () => {
      const target = anchor.current;
      const popup = panel.current;
      if (!target || !popup) return;
      const rect = target.getBoundingClientRect();
      const width = popup.offsetWidth;
      const height = popup.offsetHeight;
      const left = Math.max(
        8,
        Math.min(rect.left, window.innerWidth - width - 8),
      );
      const below = rect.bottom + 6;
      const top =
        below + height <= window.innerHeight - 8
          ? below
          : Math.max(8, rect.top - height - 6);
      popup.style.left = `${left}px`;
      popup.style.top = `${top}px`;
      popup.style.visibility = "visible";
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && activePath.at(-1) === id) {
        hoverSuppressed = true;
        event.stopImmediatePropagation();
        close(id);
      }
    };
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!insideBranch(id, event.target)) close(id);
    };
    const schedulePosition = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          position();
        });
    };
    position();
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, {
      capture: true,
      passive: true,
    });
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", schedulePosition, true);
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", dismiss);
      if (closing.current) clearTimeout(closing.current);
    };
  }, [open, id]);

  const triggerProps: HTMLAttributes<HTMLElement> = {
    className,
    "aria-describedby": open ? id : undefined,
    onPointerEnter: (event) => {
      if (event.pointerType !== "touch") show(event.currentTarget, true);
    },
    onPointerMove: (event) => {
      if (event.pointerType === "touch") return;
      hoverSuppressed = false;
      if (activePath.at(-1) !== id) show(event.currentTarget, true);
    },
    onPointerLeave: scheduleClose,
    onFocus: (event) => show(event.currentTarget),
    onBlur: (event) => {
      if (!insideBranch(id, event.relatedTarget)) hide();
    },
  };
  return (
    <>
      {href ? (
        <Link href={href} prefetch={open && prefetchReady} {...triggerProps}>
          {children}
        </Link>
      ) : (
        <button
          type="button"
          {...triggerProps}
          onClick={(event) => show(event.currentTarget)}
        >
          {children}
        </button>
      )}
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="tooltip"
            className="game-hover-tooltip"
            data-tooltip-depth={ancestors.length}
            style={{
              ...(width === undefined
                ? {}
                : { width: `min(${width}px, calc(100vw - 16px))` }),
              zIndex: 100 + ancestors.length,
            }}
            onPointerEnter={cancelClose}
            onPointerLeave={scheduleClose}
            onBlur={(event) => {
              if (!insideBranch(id, event.relatedTarget)) hide();
            }}
          >
            <TooltipAncestors value={path}>{content}</TooltipAncestors>
          </div>,
          document.body,
        )}
    </>
  );
}
