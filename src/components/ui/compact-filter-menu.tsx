"use client";
import { ChevronDown } from "lucide-react";
import { useRef, type ReactNode } from "react";

import { useCompactMenu } from "./use-compact-menu";

export function CompactFilterMenu({
  title,
  count,
  children,
  trigger,
  onOpen,
  className = "",
}: {
  title: string;
  count: number;
  children: ReactNode;
  trigger?: ReactNode;
  onOpen?: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useCompactMenu(ref, onOpen);
  return (
    <details ref={ref} data-filter-menu className={`compact-menu ${className}`}>
      <summary
        role="button"
        className="compact-menu-trigger"
        aria-label={trigger ? title : undefined}
      >
        {trigger ?? title}
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
