import type { ElementType, ReactNode } from "react";

export function Panel({
  children,
  as: Component = "section",
  className = "",
}: {
  children: ReactNode;
  as?: ElementType;
  className?: string;
}) {
  return (
    <Component className={`bg-[var(--surface-panel)] ${className}`}>
      {children}
    </Component>
  );
}
