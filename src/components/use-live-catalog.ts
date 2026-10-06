"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  getBrowserReplica,
  prefetchSibling,
  checkCatalogHead,
} from "@/browser/catalog-replica";
import {
  queryReplica,
  type CatalogReplica,
  type ReplicaEntity,
} from "@/domain/catalog-replica";
import type { HeroFilters } from "@/server/services/hero-filters";
import type { AbilityFilters } from "@/server/services/ability-filters";
import type { VersionedListSlice } from "@/domain/infinite-list";
import type { SearchParams } from "@/server/services/hero-filters";

export function readFilterParams(
  entries: Iterable<[string, FormDataEntryValue | string]>,
): SearchParams {
  const params: SearchParams = {};
  for (const [key, value] of entries) {
    if (typeof value !== "string") continue;
    const previous = params[key];
    params[key] =
      previous === undefined
        ? value
        : [...(Array.isArray(previous) ? previous : [previous]), value];
  }
  return params;
}

export function useFilterEvents(
  onChange: (data: FormData, composing: boolean) => void,
) {
  const composing = useRef(false);
  return {
    onFieldChange(event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
      if (event.currentTarget.form)
        onChange(new FormData(event.currentTarget.form), composing.current);
    },
    onCompositionStart() {
      composing.current = true;
    },
    onCompositionEnd(event: React.CompositionEvent<HTMLFormElement>) {
      composing.current = false;
      onChange(new FormData(event.currentTarget), false);
    },
    onSubmit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!composing.current)
        onChange(new FormData(event.currentTarget), false);
    },
  };
}

interface Options<T, F> {
  path: string;
  localEntity?: ReplicaEntity;
  initialSlice: VersionedListSlice<T>;
  initialFilters: F;
  initialErrors?: string[];
  parse: (params: SearchParams) => { filters: F; errors: string[] };
  canonical: (filters: F) => string;
}

export function useLiveCatalog<
  T,
  F extends { q: string; lang: "en" | "zh-CN" },
>({
  path,
  localEntity,
  initialSlice,
  initialFilters,
  initialErrors = [],
  parse,
  canonical,
}: Options<T, F>) {
  const router = useRouter();
  const replicas = useRef(new Map<string, CatalogReplica>());
  const initialQuery = canonical(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [result, setResult] = useState({
    slice: initialSlice,
    query: initialQuery,
    lang: initialFilters.lang,
    local: false,
  });
  const [validationErrors, setValidationErrors] = useState(initialErrors);
  const [busy, setBusy] = useState(false);
  const [restorePending, setRestorePending] = useState(Boolean(localEntity));
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(
    new Map(initialErrors.length ? [] : [[initialQuery, initialSlice]]),
  );
  const pending = useRef<{
    controller?: AbortController;
    timer?: ReturnType<typeof setTimeout>;
    generation: number;
    query: string | null;
  }>({ generation: 0, query: initialErrors.length ? null : initialQuery });
  const endpoint = useCallback(
    (query: string) => {
      const params = new URLSearchParams(query);
      params.set("datasetVersionId", initialSlice.datasetVersionId);
      params.set("assetDatasetVersionId", initialSlice.assetDatasetVersionId);
      return `/api/catalog${path}?${params}`;
    },
    [path, initialSlice.datasetVersionId, initialSlice.assetDatasetVersionId],
  );

  const request = useCallback(
    (next: F, delay: number, force = false) => {
      const query = canonical(next);
      const state = pending.current;
      if (!force && state.query === query) return;
      state.query = query;
      state.generation += 1;
      const generation = state.generation;
      clearTimeout(state.timer);
      state.controller?.abort();
      setError(null);
      const replica = replicas.current.get(next.lang);
      if (replica) {
        const slice = queryReplica(
          replica,
          next as unknown as HeroFilters | AbilityFilters,
        ) as VersionedListSlice<T>;
        setResult({ slice, query, lang: next.lang, local: true });
        setBusy(false);
        return;
      }
      const hit = cache.current.get(query);
      if (hit) {
        cache.current.delete(query);
        cache.current.set(query, hit);
        setResult({ slice: hit, query, lang: next.lang, local: false });
        setBusy(false);
        return;
      }
      setBusy(true);
      state.timer = setTimeout(async () => {
        const controller = new AbortController();
        state.controller = controller;
        try {
          // Once a replica exists, changing language downloads that language's
          // missing blocks once instead of also issuing a redundant filter query.
          if (localEntity && replicas.current.size) {
            try {
              const replica = await getBrowserReplica({
                entity: localEntity,
                locale: next.lang,
                datasetVersionId: initialSlice.datasetVersionId,
                assetDatasetVersionId: initialSlice.assetDatasetVersionId,
              });
              if (
                controller.signal.aborted ||
                pending.current.generation !== generation
              )
                return;
              replicas.current.set(next.lang, replica);
              const slice = queryReplica(
                replica,
                next as unknown as HeroFilters | AbilityFilters,
              ) as VersionedListSlice<T>;
              setResult({ slice, query, lang: next.lang, local: true });
              setBusy(false);
              return;
            } catch {
              /* Keep the online filter path when replica sync fails. */
            }
          }
          const response = await fetch(endpoint(query), {
            signal: controller.signal,
          });
          const body = await response.json();
          if (!response.ok)
            throw new Error(body.message || "筛选失败，请重试。");
          if (
            controller.signal.aborted ||
            pending.current.generation !== generation
          )
            return;
          const slice = body as VersionedListSlice<T>;
          if (
            !Array.isArray(slice.items) ||
            slice.datasetVersionId !== initialSlice.datasetVersionId ||
            slice.assetDatasetVersionId !== initialSlice.assetDatasetVersionId
          )
            throw new Error("资料版本已变化，请刷新页面。");
          cache.current.set(query, slice);
          if (cache.current.size > 32)
            cache.current.delete(cache.current.keys().next().value!);
          setResult({ slice, query, lang: next.lang, local: false });
          setBusy(false);
        } catch (cause) {
          if (
            controller.signal.aborted ||
            pending.current.generation !== generation
          )
            return;
          setError(
            cause instanceof Error ? cause.message : "筛选失败，请重试。",
          );
          setBusy(false);
        }
      }, delay);
    },
    [
      canonical,
      endpoint,
      localEntity,
      initialSlice.datasetVersionId,
      initialSlice.assetDatasetVersionId,
    ],
  );

  useEffect(() => {
    if (!localEntity) return;
    let cancelled = false;
    // Give IndexedDB a brief chance before starting redundant cursor requests.
    // A slow/missing replica never prevents online pagination beyond this grace.
    const grace = setTimeout(() => setRestorePending(false), 200);
    const identity = {
      entity: localEntity,
      locale: filters.lang,
      datasetVersionId: initialSlice.datasetVersionId,
      assetDatasetVersionId: initialSlice.assetDatasetVersionId,
    };
    const prepare = async () => {
      try {
        const replica = await getBrowserReplica(identity);
        if (cancelled) return;
        replicas.current.set(identity.locale, replica);
        const current = parse(
          readFilterParams(new URLSearchParams(window.location.search)),
        );
        if (!current.errors.length && current.filters.lang === identity.locale)
          request(current.filters, 0, true);
        // Warm the other catalog after the current one is usable. A single
        // shared promise prevents duplicate transfers across page transitions.
        prefetchSibling(identity);
      } catch {
        /* Online cursor queries remain available if storage/sync fails. */
      } finally {
        clearTimeout(grace);
        if (!cancelled) setRestorePending(false);
      }
    };
    void prepare();
    return () => {
      cancelled = true;
      clearTimeout(grace);
    };
  }, [
    localEntity,
    filters.lang,
    initialSlice.datasetVersionId,
    initialSlice.assetDatasetVersionId,
    parse,
    request,
  ]);

  useEffect(() => {
    if (!localEntity) return;
    let cancelled = false;
    const identity = {
      entity: localEntity,
      locale: filters.lang,
      datasetVersionId: initialSlice.datasetVersionId,
      assetDatasetVersionId: initialSlice.assetDatasetVersionId,
    };
    const check = async () => {
      if (document.visibilityState === "hidden" || !navigator.onLine) return;
      try {
        const head = await checkCatalogHead(identity);
        if (head === undefined || cancelled) return;
        if (
          head &&
          head.datasetVersionId === identity.datasetVersionId &&
          head.assetDatasetVersionId === identity.assetDatasetVersionId
        )
          return;
        if (head) await getBrowserReplica({ ...identity, ...head });
        if (!cancelled) router.refresh();
      } catch {
        /* Offline: retain the verified, pinned local replica. */
      }
    };
    const timer = setInterval(() => void check(), 60_000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [
    localEntity,
    filters.lang,
    initialSlice.datasetVersionId,
    initialSlice.assetDatasetVersionId,
    router,
  ]);

  const update = useCallback(
    (data: FormData, composing: boolean) => {
      const params = readFilterParams(data.entries());
      const parsed = parse(params);
      const rawQ = typeof params.q === "string" ? params.q : "";
      // Preserve the caret, spaces and the IME draft; normalize only the query.
      setFilters({ ...parsed.filters, q: rawQ });
      if (composing) return;
      setValidationErrors(parsed.errors);
      if (parsed.errors.length) return;
      const query = canonical(parsed.filters);
      window.history.replaceState(null, "", query ? `${path}?${query}` : path);
      const textChanged =
        new URLSearchParams(pending.current.query ?? "").get("q") !==
        (parsed.filters.q || null);
      request(parsed.filters, textChanged && parsed.filters.q ? 80 : 0);
    },
    [canonical, parse, path, request],
  );

  const clear = useCallback(() => {
    const next = parse({}).filters;
    setFilters(next);
    setValidationErrors([]);
    window.history.replaceState(null, "", path);
    request(next, 0);
  }, [parse, path, request]);

  useEffect(() => {
    const state = pending.current;
    const restore = () => {
      if (window.location.pathname !== path) return;
      const parsed = parse(
        readFilterParams(new URLSearchParams(window.location.search)),
      );
      if (parsed.errors.length) {
        setValidationErrors(parsed.errors);
        return;
      }
      if (canonical(parsed.filters) === pending.current.query) return;
      setValidationErrors([]);
      setFilters(parsed.filters);
      request(parsed.filters, 0);
    };
    // Next can restore the original server payload after returning from a
    // detail page. Reconcile its initial query with the shallow history URL.
    const frame = requestAnimationFrame(restore);
    window.addEventListener("popstate", restore);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("popstate", restore);
      clearTimeout(state.timer);
      state.controller?.abort();
      state.generation += 1;
    };
  }, [path, parse, request, canonical]);

  return {
    filters,
    validationErrors,
    result,
    busy,
    restorePending,
    error,
    update,
    clear,
    retry: () =>
      request(
        parse(readFilterParams(new URLSearchParams(window.location.search)))
          .filters,
        0,
        true,
      ),
    endpoint: endpoint(result.query),
  };
}
