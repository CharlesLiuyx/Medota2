"use client";

import { AlertCircle } from "lucide-react";
import { InfiniteList } from "@/components/infinite-list";

export function ValidationErrorList({
  errors,
  surface = false,
}: {
  errors: string[];
  surface?: boolean;
}) {
  const items = errors.map((message, index) => ({
    id: `${index}:${message}`,
    message,
  }));

  return (
    <div
      className={`flex items-start gap-3 border border-[color-mix(in_srgb,var(--status-danger)_35%,transparent)] p-4 text-xs text-[var(--status-danger)] ${surface ? "bg-[color-mix(in_srgb,var(--status-danger)_7%,transparent)]" : ""}`}
    >
      <AlertCircle className="size-4 shrink-0" />
      <InfiniteList
        source={{
          kind: "local",
          items,
          identity: items.map((item) => item.id).join("\u0000"),
        }}
        getKey={(item) => item.id}
        ariaLabel="Query validation errors"
        className="space-y-1"
        renderChunk={(chunk) =>
          chunk.map((item) => (
            <p
              key={item.id}
              role="listitem"
              data-infinite-list-item=""
              data-infinite-list-key={item.id}
            >
              {item.message}
            </p>
          ))
        }
      />
    </div>
  );
}
