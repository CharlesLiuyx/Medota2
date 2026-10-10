"use client";
import { useEffect, useRef, type RefObject } from "react";

/** Single lifecycle for all single/multiple selection surfaces; no React render on opening. */
export function useCompactMenu(
  ref: RefObject<HTMLDetailsElement | null>,
  onOpen?: () => void,
) {
  const callback = useRef(onOpen);
  useEffect(() => {
    callback.current = onOpen;
  });
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const trigger = details.querySelector("summary")!;
    const popup = details.querySelector<HTMLElement>(".compact-menu-popup")!;
    let opened = false;
    let frame = 0;
    const resize =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => schedule());
    const close = () => {
      details.open = false;
      sync();
    };
    const outside = (event: PointerEvent) => {
      if (!details.contains(event.target as Node)) close();
    };
    const focusOut = (event: FocusEvent) => {
      if (!details.contains(event.relatedTarget as Node | null)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && details.open) {
        event.preventDefault();
        event.stopPropagation();
        close();
        trigger.focus({ preventScroll: true });
      }
    };
    const position = () => {
      frame = 0;
      if (!opened) return;
      const anchor = trigger.getBoundingClientRect();
      const bounds = popup.getBoundingClientRect();
      popup.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`;
      popup.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - bounds.height - 8))}px`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(position);
    };
    const moved = (event: Event) => {
      if (!(event.target instanceof Node) || !popup.contains(event.target))
        schedule();
    };
    const sync = () => {
      trigger.setAttribute("aria-expanded", String(details.open));
      if (opened === details.open) return;
      opened = details.open;
      if (opened) {
        document
          .querySelectorAll<HTMLDetailsElement>(
            "details[data-filter-menu][open]",
          )
          .forEach((other) => {
            if (other !== details && !other.contains(details))
              other.open = false;
          });
        // Top layer avoids clipping by tables, scroll panels and nested column dialogs.
        if (popup.showPopover) {
          popup.setAttribute("popover", "manual");
          popup.showPopover();
        }
        Object.assign(popup.style, {
          position: "fixed",
          inset: "auto",
          margin: "0",
          translate: "none",
          border: "0",
          color: "var(--text-secondary)",
          left: "0px",
          top: "0px",
        });
        position();
        resize?.observe(popup);
        resize?.observe(trigger);
        document.addEventListener("pointerdown", outside);
        details.addEventListener("keydown", escape);
        details.addEventListener("focusout", focusOut);
        window.addEventListener("resize", moved);
        document.addEventListener("scroll", moved, true);
        callback.current?.();
      } else {
        resize?.disconnect();
        cancelAnimationFrame(frame);
        frame = 0;
        popup.hidePopover?.();
        document.removeEventListener("pointerdown", outside);
        details.removeEventListener("keydown", escape);
        details.removeEventListener("focusout", focusOut);
        window.removeEventListener("resize", moved);
        document.removeEventListener("scroll", moved, true);
      }
    };
    const click = (event: MouseEvent) => {
      if (!trigger.contains(event.target as Node)) return;
      event.preventDefault();
      if (trigger.getAttribute("aria-disabled") === "true") return;
      details.open = !details.open;
      sync();
    };
    trigger.addEventListener("click", click);
    details.addEventListener("toggle", sync);
    sync();
    return () => {
      close();
      trigger.removeEventListener("click", click);
      details.removeEventListener("toggle", sync);
    };
  }, [ref]);
}
