"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AttributeOwnerKind } from "@/domain/attributes";
import type { CatalogAttributeResponse } from "@/presentation/catalog-table-columns";

export function useCatalogTableAttributes(kind: AttributeOwnerKind) {
  const release = useSearchParams().get("release");
  const key = `${release}:${kind}`;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: CatalogAttributeResponse;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!release) return;
    const controller = new AbortController();
    const load = async () => {
      try {
        const response = await fetch(
          `/api/catalog/table-attributes?${new URLSearchParams({ release, kind })}`,
          { signal: controller.signal },
        );
        const data = (await response.json()) as CatalogAttributeResponse;
        if (
          !response.ok ||
          data.version !== 1 ||
          data.kind !== kind ||
          data.release !== release ||
          !Array.isArray(data.columns) ||
          !data.values ||
          (release.startsWith("c:") &&
            data.datasetVersionId !== release.slice(2))
        )
          throw new Error("Invalid catalog attribute response");
        if (!controller.signal.aborted) setResult({ key, data });
      } catch {
        if (!controller.signal.aborted) setResult({ key, failed: true });
      }
    };
    void load();
    return () => controller.abort();
  }, [release, kind, key, attempt]);
  const current = result?.key === key ? result : undefined;
  return {
    data: current?.data,
    loading: Boolean(release) && !current,
    failed: !release || Boolean(current?.failed),
    retry: () => {
      setResult(undefined);
      setAttempt((value) => value + 1);
    },
  };
}
