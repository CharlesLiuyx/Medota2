import type { ReactNode } from "react";

export function CatalogHeader({
  header,
  children,
}: {
  header: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-catalog-header
      className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-3"
    >
      <div className="shrink-0">{header}</div>
      <div className="w-full min-w-0 lg:ml-auto lg:w-auto lg:max-w-[calc(100%_-_12rem)]">
        {children}
      </div>
    </div>
  );
}
