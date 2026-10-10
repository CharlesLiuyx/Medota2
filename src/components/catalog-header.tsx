import type { ReactNode } from "react";

export function CatalogHeader({
  header,
  children,
  viewSwitch,
}: {
  header: ReactNode;
  children: ReactNode;
  viewSwitch?: ReactNode;
}) {
  return (
    <div
      data-catalog-header
      className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        {header}
        {viewSwitch}
        {viewSwitch && <div data-catalog-table-tools className="min-w-0" />}
      </div>
      <div className="w-full min-w-0 lg:ml-auto lg:w-auto lg:max-w-[calc(100%_-_12rem)]">
        {children}
      </div>
    </div>
  );
}
