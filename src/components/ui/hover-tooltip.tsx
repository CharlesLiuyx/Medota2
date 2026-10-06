"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

let activeTooltip: string | null = null;
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
function setActive(id: string | null) {
  if (activeTooltip === id) return;
  const previous = activeTooltip;
  activeTooltip = id;
  // Only the old and new anchors need to render, independent of catalog size.
  if (previous)
    for (const listener of listeners.get(previous) ?? []) listener();
  if (id) for (const listener of listeners.get(id) ?? []) listener();
}
const serverSnapshot = () => false;
function close(id: string) {
  if (activeTooltip === id) setActive(null);
}

/** Opens synchronously; the short exit grace lets the pointer cross into the panel. */
export function HoverTooltip({
  children,
  content,
  href,
  className,
}: {
  children: ReactNode;
  content: ReactNode;
  href: string;
  className?: string;
}) {
  const id = useId();
  const listen = useCallback(
    (listener: () => void) => subscribe(id, listener),
    [id],
  );
  const snapshot = useCallback(() => activeTooltip === id, [id]);
  const open = useSyncExternalStore(listen, snapshot, serverSnapshot);
  const [prefetchReady, setPrefetchReady] = useState(false);
  // Only the active anchor opts into full route prefetch. A short dwell avoids
  // fetching hundreds of detail pages while the pointer crosses a dense grid.
  useEffect(() => {
    if (!open || prefetchReady) return;
    const timer = setTimeout(() => setPrefetchReady(true), 120);
    return () => clearTimeout(timer);
  }, [open, prefetchReady]);
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
    closing.current = setTimeout(() => close(id), 90);
  };
  const show = (element: HTMLElement, pointer = false) => {
    if (pointer && hoverSuppressed) return;
    cancelClose();
    anchor.current = element;
    setActive(id);
  };

  useEffect(
    () => () => {
      if (closing.current) clearTimeout(closing.current);
      close(id);
    },
    [id],
  );

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
      if (event.key === "Escape") {
        hoverSuppressed = true;
        close(id);
      }
    };
    const dismiss = (event: globalThis.PointerEvent) => {
      if (
        event.target instanceof Node &&
        !anchor.current?.contains(event.target) &&
        !panel.current?.contains(event.target)
      )
        close(id);
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

  return (
    <>
      <Link
        href={href}
        prefetch={open && prefetchReady}
        className={className}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") show(event.currentTarget, true);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return;
          hoverSuppressed = false;
          if (activeTooltip !== id) show(event.currentTarget, true);
        }}
        onPointerLeave={scheduleClose}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={hide}
      >
        {children}
      </Link>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="tooltip"
            className="game-hover-tooltip"
            onPointerEnter={cancelClose}
            onPointerLeave={scheduleClose}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
