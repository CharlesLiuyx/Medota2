"use client";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  readPersistentResource,
  persistResource,
} from "@/browser/persistent-resources";
import { useSearchParams } from "next/navigation";
import type { AttributeOwnerKind } from "@/domain/attributes";
import type {
  CatalogAttributeManifest,
  CatalogAttributeValues,
} from "@/presentation/catalog-table-columns";
import {
  browserResources,
  browserScope,
  loadBrowserResource,
  resourceScheduler,
  verifyResourceResponse,
} from "@/browser/resources";

const endpoint = (release: string, kind: AttributeOwnerKind) =>
  `/api/catalog/table-attributes?${new URLSearchParams({ release, kind })}`;

const subscribeToHydration = () => () => {};
const hydrated = () => true;
const notHydrated = () => false;
function useResourceScope() {
  const ready = useSyncExternalStore(
    subscribeToHydration,
    hydrated,
    notHydrated,
  );
  if (!ready) return undefined;
  try {
    return browserScope();
  } catch {
    return undefined;
  }
}

export function useCatalogTableAttributes(kind: AttributeOwnerKind) {
  const release = useSearchParams().get("release");
  const scope = useResourceScope();
  const key =
    scope && release
      ? `${scope}:${JSON.stringify(["attribute-manifest/2", release, kind])}`
      : undefined;
  const [attempt, setAttempt] = useState(0);
  const snapshot = useMemo(
    () => ({
      attempt,
      data: key
        ? (browserResources.peek(key) as CatalogAttributeManifest | undefined)
        : undefined,
    }),
    [key, attempt],
  );
  const cached = snapshot.data;
  const [result, setResult] = useState<{
    key: string;
    data?: CatalogAttributeManifest;
    failed?: boolean;
  }>();
  useEffect(() => {
    if (!release || !key || cached) return;
    let disposed = false;
    const load = async () => {
      const data = await loadBrowserResource(
        key,
        async () => {
          const response = await fetch(endpoint(release, kind), {
            signal: AbortSignal.timeout(20_000),
          });
          if (response.ok) verifyResourceResponse(response);
          const data = (await response.json()) as CatalogAttributeManifest;
          if (
            !response.ok ||
            data.version !== 2 ||
            data.kind !== kind ||
            data.release !== release ||
            !data.resourceId ||
            !Array.isArray(data.columns) ||
            (release.startsWith("c:") &&
              data.datasetVersionId !== release.slice(2))
          )
            throw new Error("Invalid catalog attribute manifest");
          return data;
        },
        "foreground",
        60_000,
      );
      if (!disposed) setResult({ key, data });
    };
    void load().catch(() => {
      if (!disposed) setResult({ key, failed: true });
    });
    return () => {
      disposed = true;
    };
  }, [release, kind, key, attempt, cached]);
  const current = result?.key === key ? result : undefined;
  return {
    data: cached ?? current?.data,
    loading: Boolean(release) && !cached && !current,
    failed: !release || Boolean(current?.failed),
    retry: () => {
      if (key) browserResources.delete(key);
      setResult(undefined);
      setAttempt((value) => value + 1);
    },
  };
}

type ColumnValues = Record<string, string[]>;
export function useCatalogAttributeValues(
  manifest: CatalogAttributeManifest | undefined,
  columns: string[],
) {
  const selection = JSON.stringify([...columns].sort());
  const scope = useResourceScope();
  const key =
    scope && manifest
      ? `${scope}:${JSON.stringify([manifest.resourceId])}`
      : undefined;
  const [result, setResult] = useState<{
    key: string;
    values: Record<string, ColumnValues>;
    loaded: Set<string>;
  }>();
  const [failed, setFailed] = useState<string>();
  const [stale, setStale] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const cached = useMemo(() => {
    if (!key || !manifest) return undefined;
    const values: Record<string, ColumnValues> = {};
    const loaded = new Set<string>();
    for (const column of JSON.parse(selection) as string[]) {
      const value = browserResources.peek(
        `${scope}:${JSON.stringify([manifest.resourceId, column])}`,
      ) as ColumnValues | undefined;
      if (value !== undefined) {
        values[column] = value;
        loaded.add(column);
      }
    }
    return { key, attempt, values, loaded };
  }, [scope, key, manifest, selection, attempt]);
  const allCached = Boolean(cached && cached.loaded.size === columns.length);
  useEffect(() => {
    if (!manifest || !key || allCached) return;
    let disposed = false;
    const selected = JSON.parse(selection) as string[];
    const load = async () => {
      const keyFor = (column: string) =>
        `${scope}:${JSON.stringify([manifest.resourceId, column])}`;
      const missing = selected.filter(
        (column) => !browserResources.has(keyFor(column)),
      );
      const persisted = Promise.all(
        missing.map(
          async (column) =>
            [
              column,
              await readPersistentResource<ColumnValues>(keyFor(column)),
            ] as const,
        ),
      ).then((values) => new Map(values));
      // Register every column's in-flight work before the next effect can request it.
      let batch: Promise<CatalogAttributeValues> | undefined;
      const fetchBatch = () =>
        (batch ??= resourceScheduler.schedule(
          `${scope}:${JSON.stringify([manifest.resourceId, missing])}`,
          "foreground",
          async () => {
            const stored = await persisted;
            const requested = missing.filter((column) => !stored.get(column));
            const response = await fetch(
              endpoint(manifest.release, manifest.kind),
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  resourceId: manifest.resourceId,
                  columns: requested,
                }),
                signal: AbortSignal.timeout(20_000),
              },
            );
            if (response.status === 409) throw new StaleManifestError();
            if (response.ok) verifyResourceResponse(response);
            const data = (await response.json()) as CatalogAttributeValues;
            if (
              !response.ok ||
              data.version !== 2 ||
              data.resourceId !== manifest.resourceId ||
              !data.values ||
              !Array.isArray(data.loadedColumns) ||
              requested.some((column) => !data.loadedColumns.includes(column))
            )
              throw new Error("Invalid catalog attribute values");
            return data;
          },
        ));
      // One scheduled request for the batch; per-column cache entries share its result.
      const values = await Promise.all(
        selected.map(async (column) => {
          const value = (await browserResources.get(
            keyFor(column),
            async () => {
              const cached = (await persisted).get(column);
              if (cached) return cached;
              const data = await fetchBatch();
              const value = Object.fromEntries(
                Object.entries(data.values)
                  .filter(([, values]) => column in values)
                  .map(([owner, values]) => [owner, values[column]]),
              );
              void persistResource(
                keyFor(column),
                `${scope}:${JSON.stringify(["attribute-column/2", manifest.kind, column])}`,
                value,
              );
              return value;
            },
          )) as ColumnValues;
          return [column, value] as const;
        }),
      );
      if (!disposed) {
        setResult({
          key,
          values: Object.fromEntries(values),
          loaded: new Set(selected),
        });
        setFailed(undefined);
        setStale(undefined);
      }
    };
    void load().catch((error) => {
      if (!disposed) {
        setFailed(`${key}:${selection}`);
        if (error instanceof StaleManifestError) setStale(key);
      }
    });
    return () => {
      disposed = true;
    };
  }, [scope, manifest, key, selection, attempt, allCached]);
  const current = useMemo(() => {
    if (allCached || result?.key !== key) return cached;
    if (!result || !cached) return result;
    return {
      key,
      values: { ...result.values, ...cached.values },
      loaded: new Set([...result.loaded, ...cached.loaded]),
    };
  }, [allCached, cached, result, key]);
  return {
    values: current?.values,
    loaded: current?.loaded,
    failed: !allCached && failed === `${key}:${selection}`,
    stale: !allCached && Boolean(key && stale === key),
    retry: () => setAttempt((value) => value + 1),
  };
}
class StaleManifestError extends Error {}
