"use client";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useTranslations } from "@/i18n/provider";

/** Non-modal so item brief portals stay interactive; only mounted while choosing. */
export function InventoryPickerPanel({
  anchor,
  inputRef,
  relatedControlsRef,
  title,
  onClose,
  children,
}: {
  anchor: HTMLElement;
  inputRef: RefObject<HTMLInputElement | null>;
  relatedControlsRef?: RefObject<HTMLElement | null>;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const t = useTranslations();
  useLayoutEffect(() => {
    closeRef.current = onClose;
  });
  useLayoutEffect(() => {
    const position = () => {
      const element = panel.current;
      if (!element) return;
      const rect = anchor.getBoundingClientRect();
      const top = rect.bottom + 6;
      element.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - element.offsetWidth - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(top, innerHeight - element.offsetHeight - 8))}px`;
    };
    position();
    inputRef.current?.focus({ preventScroll: true });
    const observer = new ResizeObserver(position);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [anchor, inputRef]);
  useEffect(() => {
    const dismiss = (event: Event) => {
      const target = event.target;
      if (
        !(target instanceof Element) ||
        panel.current?.contains(target) ||
        anchor.contains(target) ||
        relatedControlsRef?.current?.contains(target) ||
        target.closest('[role="tooltip"]')
      )
        return;
      closeRef.current();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector('[role="tooltip"]'))
        return;
      event.preventDefault();
      closeRef.current();
      anchor.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("focusin", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("focusin", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [anchor, relatedControlsRef]);
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label={title}
      data-inventory-picker-panel
      className="fixed z-80 w-[min(760px,calc(100vw-16px))] max-h-[calc(100dvh-16px)] overflow-y-auto border border-white/10 bg-[#19232b] p-2 shadow-2xl"
    >
      <div className="mb-2 flex items-center justify-between gap-2 text-xs text-[#d8c49a]">
        <strong>{title}</strong>
        <button
          type="button"
          aria-label={t("关闭")}
          className="p-1 hover:bg-white/10"
          onClick={() => {
            onClose();
            anchor.focus({ preventScroll: true });
          }}
        >
          <X size={14} />
        </button>
      </div>
      {children}
    </div>,
    document.body,
  );
}
