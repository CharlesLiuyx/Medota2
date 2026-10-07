"use client";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

export function CompactFilterMenu({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        ref.current?.removeAttribute("open");
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && ref.current?.open) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, []);
  return (
    <details
      ref={ref}
      data-filter-menu
      className="compact-menu"
      onToggle={(event) => {
        const current = event.currentTarget;
        if (current.open)
          document
            .querySelectorAll<HTMLDetailsElement>(
              "details[data-filter-menu][open]",
            )
            .forEach((other) => {
              if (other !== current) other.open = false;
            });
      }}
    >
      <summary className="compact-menu-trigger">
        {title}
        {count > 0 && (
          <span className="text-[var(--accent-hover)]">{count}</span>
        )}
        <ChevronDown
          aria-hidden="true"
          className="compact-menu-chevron"
          strokeWidth={2.5}
        />
      </summary>
      <div className="compact-menu-popup">{children}</div>
    </details>
  );
}
