"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  INFINITE_LIST_LOCAL_CHUNK_SIZE,
  infiniteListPrefetchMargins,
  infiniteListPrefetchRootMargin,
  type InfiniteListProblem,
  type ListLoadDirection,
  type ListSlice,
} from "@/domain/infinite-list";

type StableKey = string | number;

export interface RemoteCursorListSource<T> {
  kind: "remote";
  endpoint: string;
  initialSlice: ListSlice<T>;
  identity?: string;
}

export interface LocalArrayListSource<T> {
  kind: "local";
  items: readonly T[];
  chunkSize?: number;
  initialChunkIndex?: number;
  identity?: string;
}

export type InfiniteListSource<T> =
  RemoteCursorListSource<T> | LocalArrayListSource<T>;

export interface InfiniteListMessages {
  loadingBefore: string;
  loadingAfter: string;
  loadFailed: string;
  retryBefore: string;
  retryAfter: string;
  complete: string;
  loaded: (shown: number, total?: number) => string;
}

export interface InfiniteChunkRenderContext<T> {
  chunkId: string;
  chunkIndex: number;
  isFirstChunk: boolean;
  isLastChunk: boolean;
  previousItem: T | undefined;
  nextItem: T | undefined;
}

export interface InfiniteListChunk<T> {
  id: string;
  items: T[];
  rendered: boolean;
  measuredHeight: number | null;
}

export interface InfiniteListDirectionStatus {
  loading: boolean;
  error: string | null;
}

interface InfiniteListState<T> {
  chunks: InfiniteListChunk<T>[];
  previousCursor: string | null;
  nextCursor: string | null;
  total: number | undefined;
  before: InfiniteListDirectionStatus;
  after: InfiniteListDirectionStatus;
  liveMessage: string;
  revision: number;
}

interface ScrollAnchor {
  chunkId: string;
  top: number;
}

interface InFlightRequest {
  controller: AbortController;
  cursor: string;
  generation: number;
}

export interface UseInfiniteListOptions<T> {
  source: InfiniteListSource<T>;
  getKey: (item: T) => StableKey;
  messages?: Partial<InfiniteListMessages>;
  onStale?: (problem: InfiniteListStaleProblem) => void;
}

export type InfiniteListStaleProblem = Pick<
  InfiniteListProblem,
  "code" | "message"
> & {
  code: "invalid_cursor" | "stream_mismatch" | "dataset_unavailable";
};

export interface UseInfiniteListResult<T> {
  chunks: readonly InfiniteListChunk<T>[];
  total: number | undefined;
  shownCount: number;
  isEmpty: boolean;
  isBusy: boolean;
  hasReachedStart: boolean;
  hasReachedEnd: boolean;
  before: InfiniteListDirectionStatus;
  after: InfiniteListDirectionStatus;
  liveMessage: string;
  rootRef: (node: HTMLElement | null) => void;
  topSentinelRef: (node: HTMLElement | null) => void;
  bottomSentinelRef: (node: HTMLElement | null) => void;
  chunkRef: (chunkId: string, node: HTMLElement | null) => void;
  retryBefore: () => void;
  retryAfter: () => void;
}

export interface InfiniteListProps<T> extends UseInfiniteListOptions<T> {
  renderChunk: (
    items: readonly T[],
    context: InfiniteChunkRenderContext<T>,
  ) => ReactNode;
  emptyFallback?: ReactNode;
  className?: string;
  chunkClassName?: string;
  ariaLabel?: string;
  contentRole?: "list" | "group";
  showComplete?: boolean;
}

const DEFAULT_MESSAGES: InfiniteListMessages = {
  loadingBefore: "Loading earlier results…",
  loadingAfter: "Loading more results…",
  loadFailed: "Loading failed.",
  retryBefore: "Retry earlier results",
  retryAfter: "Retry more results",
  complete: "All results are shown.",
  loaded: (shown, total) =>
    total === undefined
      ? `${shown} results shown.`
      : `${shown} / ${total} shown.`,
};

const IDLE_DIRECTION: InfiniteListDirectionStatus = {
  loading: false,
  error: null,
};

export function useInfiniteList<T>({
  source,
  getKey,
  messages: messageOverrides,
  onStale,
}: UseInfiniteListOptions<T>): UseInfiniteListResult<T> {
  const messages = useMemo(
    () => ({ ...DEFAULT_MESSAGES, ...messageOverrides }),
    [messageOverrides],
  );
  const sourceRef = useRef(source);
  const getKeyRef = useRef(getKey);
  const messagesRef = useRef(messages);
  const onStaleRef = useRef(onStale);
  useLayoutEffect(() => {
    sourceRef.current = source;
    getKeyRef.current = getKey;
    messagesRef.current = messages;
    onStaleRef.current = onStale;
  }, [getKey, messages, onStale, source]);

  const generationRef = useRef(0);
  const staleResetStartedRef = useRef(false);
  const sequenceRef = useRef(0);
  const sourceIdentity = getSourceIdentity(source, getKey);
  const identityRef = useRef(sourceIdentity);
  const consumedRef = useRef({
    before: new Set<string>(),
    after: new Set<string>(),
  });
  const inFlightRef = useRef<{
    before: InFlightRequest | null;
    after: InFlightRequest | null;
  }>({ before: null, after: null });
  const rootElementRef = useRef<HTMLElement | null>(null);
  const topSentinelElementRef = useRef<HTMLElement | null>(null);
  const bottomSentinelElementRef = useRef<HTMLElement | null>(null);
  const chunkElementsRef = useRef(new Map<string, HTMLElement>());
  const intersectionObserverRef = useRef<IntersectionObserver | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const fallbackFrameRef = useRef<number | null>(null);
  const boundaryIntersectingRef = useRef({ before: false, after: false });
  const pendingAnchorRef = useRef<ScrollAnchor | null>(null);

  const makeChunk = useCallback((items: T[]): InfiniteListChunk<T> => {
    sequenceRef.current += 1;
    return {
      id: `infinite-chunk-${generationRef.current}-${sequenceRef.current}`,
      items,
      rendered: true,
      measuredHeight: null,
    };
  }, []);

  const [state, setState] = useState<InfiniteListState<T>>(() =>
    createInitialState(source, 0),
  );
  const stateRef = useRef(state);

  const commit = useCallback(
    (update: (current: InfiniteListState<T>) => InfiniteListState<T>) => {
      const current = stateRef.current;
      const next = update(current);
      if (next === current) return;
      stateRef.current = next;
      setState(next);
    },
    [],
  );

  const abortRequests = useCallback(() => {
    inFlightRef.current.before?.controller.abort();
    inFlightRef.current.after?.controller.abort();
    inFlightRef.current = { before: null, after: null };
  }, []);

  useLayoutEffect(() => {
    if (identityRef.current === sourceIdentity) return;

    abortRequests();
    generationRef.current += 1;
    identityRef.current = sourceIdentity;
    consumedRef.current = { before: new Set(), after: new Set() };
    staleResetStartedRef.current = false;
    boundaryIntersectingRef.current = { before: false, after: false };
    pendingAnchorRef.current = null;
    const next = createInitialState(sourceRef.current, generationRef.current);
    stateRef.current = next;
    setState(next);
  }, [abortRequests, sourceIdentity]);

  useEffect(
    () => () => {
      generationRef.current += 1;
      abortRequests();
      if (fallbackFrameRef.current !== null) {
        window.cancelAnimationFrame(fallbackFrameRef.current);
      }
    },
    [abortRequests],
  );

  const captureAnchor = useCallback((): ScrollAnchor | null => {
    const root = rootElementRef.current;
    if (!root) return null;
    const viewportHeight = window.innerHeight;
    const elements = root.querySelectorAll<HTMLElement>(
      "[data-infinite-chunk-id]",
    );
    let closest: { element: HTMLElement; distance: number } | null = null;

    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < viewportHeight) {
        return {
          chunkId: element.dataset.infiniteChunkId ?? "",
          top: rect.top,
        };
      }
      const distance = Math.min(Math.abs(rect.top), Math.abs(rect.bottom));
      if (!closest || distance < closest.distance)
        closest = { element, distance };
    }

    return closest
      ? {
          chunkId: closest.element.dataset.infiniteChunkId ?? "",
          top: closest.element.getBoundingClientRect().top,
        }
      : null;
  }, []);

  const restoreAnchor = useCallback(() => {
    const anchor = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    if (!anchor || !rootElementRef.current) return;

    const elements = rootElementRef.current.querySelectorAll<HTMLElement>(
      "[data-infinite-chunk-id]",
    );
    const element = Array.from(elements).find(
      (candidate) => candidate.dataset.infiniteChunkId === anchor.chunkId,
    );
    if (!element) return;
    const delta = element.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) > 0.5) window.scrollBy(0, delta);
  }, []);

  const loadDirectionRef = useRef<(direction: ListLoadDirection) => void>(
    () => {
      // Assigned below; the indirection keeps observers stable across source resets.
    },
  );

  const loadDirection = useCallback(
    async (direction: ListLoadDirection) => {
      if (inFlightRef.current[direction]) return;
      const current = stateRef.current;
      const cursor =
        direction === "before" ? current.previousCursor : current.nextCursor;
      if (cursor === null) return;

      const generation = generationRef.current;
      const controller = new AbortController();
      inFlightRef.current[direction] = { controller, cursor, generation };
      commit((value) => ({
        ...value,
        [direction]: { loading: true, error: null },
      }));

      try {
        const slice = await loadSlice(
          sourceRef.current,
          direction,
          cursor,
          controller.signal,
        );
        if (generation !== generationRef.current || controller.signal.aborted) {
          return;
        }

        validatePinnedIdentity(sourceRef.current, slice);
        const existingKeys = collectKeys(
          stateRef.current.chunks,
          getKeyRef.current,
        );
        const incomingKeys = new Set<string>();
        for (const item of slice.items) {
          const key = normalizeKey(getKeyRef.current(item));
          if (incomingKeys.has(key) || existingKeys.has(key)) {
            throw new Error("The server returned a duplicate stable item key.");
          }
          incomingKeys.add(key);
        }

        const continuation =
          direction === "before" ? slice.previousCursor : slice.nextCursor;
        if (continuation === cursor) {
          throw new Error("The server returned a cursor that did not advance.");
        }
        if (
          continuation !== null &&
          consumedRef.current[direction].has(continuation)
        ) {
          throw new Error("The server returned a cursor cycle.");
        }
        if (slice.items.length === 0 && continuation !== null) {
          throw new Error("The server returned an empty slice without an end.");
        }

        if (direction === "before" && slice.items.length > 0) {
          pendingAnchorRef.current = captureAnchor();
        }
        consumedRef.current[direction].add(cursor);
        const chunk = slice.items.length > 0 ? makeChunk(slice.items) : null;

        commit((value) => {
          const chunks = chunk
            ? direction === "before"
              ? [chunk, ...value.chunks]
              : [...value.chunks, chunk]
            : value.chunks;
          const shown = countItems(chunks);
          const reachedEnd = direction === "after" && continuation === null;
          return {
            ...value,
            chunks,
            previousCursor:
              direction === "before" ? continuation : value.previousCursor,
            nextCursor: direction === "after" ? continuation : value.nextCursor,
            total: value.total ?? slice.total,
            [direction]: IDLE_DIRECTION,
            liveMessage: reachedEnd
              ? messagesRef.current.complete
              : messagesRef.current.loaded(shown, value.total ?? slice.total),
            revision: value.revision + (chunk ? 1 : 0),
          };
        });
      } catch (error) {
        if (
          generation !== generationRef.current ||
          controller.signal.aborted ||
          isAbortError(error)
        ) {
          return;
        }
        if (
          error instanceof InfiniteListSourceError &&
          isStaleProblemCode(error.code) &&
          onStaleRef.current
        ) {
          if (!staleResetStartedRef.current) {
            staleResetStartedRef.current = true;
            const problem: InfiniteListStaleProblem = {
              code: error.code,
              message: error.message,
            };
            commit((value) => ({
              ...value,
              [direction]: IDLE_DIRECTION,
              liveMessage: error.message,
            }));
            onStaleRef.current(problem);
          }
          return;
        }
        const errorMessage = getErrorMessage(error);
        commit((value) => ({
          ...value,
          [direction]: { loading: false, error: errorMessage },
          liveMessage: `${messagesRef.current.loadFailed} ${errorMessage}`,
        }));
      } finally {
        const active = inFlightRef.current[direction];
        if (
          active?.controller === controller &&
          active.generation === generation
        ) {
          inFlightRef.current[direction] = null;
        }
      }
    },
    [captureAnchor, commit, makeChunk],
  );
  useLayoutEffect(() => {
    loadDirectionRef.current = (direction) => {
      void loadDirection(direction);
    };
  }, [loadDirection]);

  const updateMeasuredHeight = useCallback(
    (chunkId: string, height: number) => {
      if (!Number.isFinite(height) || height <= 0) return;
      commit((value) => {
        const index = value.chunks.findIndex((chunk) => chunk.id === chunkId);
        if (index < 0) return value;
        const chunk = value.chunks[index];
        if (
          chunk.measuredHeight !== null &&
          Math.abs(chunk.measuredHeight - height) < 0.5
        ) {
          return value;
        }
        const chunks = [...value.chunks];
        chunks[index] = { ...chunk, measuredHeight: height };
        return { ...value, chunks };
      });
    },
    [commit],
  );

  const setChunkRendered = useCallback(
    (chunkId: string, rendered: boolean) => {
      const value = stateRef.current;
      const index = value.chunks.findIndex((chunk) => chunk.id === chunkId);
      if (index < 0 || value.chunks[index].rendered === rendered) return;
      const element = chunkElementsRef.current.get(chunkId);
      if (!element) return;

      const anchor = captureAnchor();
      if (!rendered) {
        const activeElement = document.activeElement;
        if (activeElement && element.contains(activeElement)) return;
        if (element.querySelector("details[open]")) return;
        if (anchor?.chunkId === chunkId) return;
        const height =
          value.chunks[index].measuredHeight ??
          element.getBoundingClientRect().height;
        if (!Number.isFinite(height) || height <= 0) return;
        pendingAnchorRef.current = anchor;
        commit((current) => {
          const currentIndex = current.chunks.findIndex(
            (chunk) => chunk.id === chunkId,
          );
          if (currentIndex < 0 || !current.chunks[currentIndex].rendered) {
            return current;
          }
          const chunks = [...current.chunks];
          chunks[currentIndex] = {
            ...chunks[currentIndex],
            rendered: false,
            measuredHeight: height,
          };
          return { ...current, chunks, revision: current.revision + 1 };
        });
        return;
      }

      pendingAnchorRef.current = anchor;
      commit((current) => {
        const currentIndex = current.chunks.findIndex(
          (chunk) => chunk.id === chunkId,
        );
        if (currentIndex < 0 || current.chunks[currentIndex].rendered) {
          return current;
        }
        const chunks = [...current.chunks];
        chunks[currentIndex] = { ...chunks[currentIndex], rendered: true };
        return { ...current, chunks, revision: current.revision + 1 };
      });
    },
    [captureAnchor, commit],
  );

  const handleIntersectionEntries = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const boundary = element.dataset.infiniteBoundary as
          ListLoadDirection | undefined;
        if (boundary) {
          boundaryIntersectingRef.current[boundary] = entry.isIntersecting;
          if (entry.isIntersecting) loadDirectionRef.current(boundary);
          continue;
        }
        const chunkId = element.dataset.infiniteChunkId;
        if (chunkId) setChunkRendered(chunkId, entry.isIntersecting);
      }
    },
    [setChunkRendered],
  );

  const runGeometryCheck = useCallback(() => {
    fallbackFrameRef.current = null;
    const viewportHeight = window.innerHeight;
    const top = topSentinelElementRef.current;
    const bottom = bottomSentinelElementRef.current;
    if (top) {
      const intersects = isWithinPrefetchBand(
        top.getBoundingClientRect(),
        viewportHeight,
      );
      boundaryIntersectingRef.current.before = intersects;
      if (intersects) loadDirectionRef.current("before");
    }
    if (bottom) {
      const intersects = isWithinPrefetchBand(
        bottom.getBoundingClientRect(),
        viewportHeight,
      );
      boundaryIntersectingRef.current.after = intersects;
      if (intersects) loadDirectionRef.current("after");
    }
    for (const [chunkId, element] of chunkElementsRef.current) {
      const rect = element.getBoundingClientRect();
      if (
        stateRef.current.chunks.find((chunk) => chunk.id === chunkId)?.rendered
      ) {
        updateMeasuredHeight(chunkId, rect.height);
      }
      setChunkRendered(chunkId, isWithinPrefetchBand(rect, viewportHeight));
    }
  }, [setChunkRendered, updateMeasuredHeight]);

  const scheduleGeometryCheck = useCallback(() => {
    if (fallbackFrameRef.current !== null) return;
    fallbackFrameRef.current = window.requestAnimationFrame(runGeometryCheck);
  }, [runGeometryCheck]);

  const isEmpty =
    state.total === 0 ||
    (state.chunks.length === 0 &&
      state.previousCursor === null &&
      state.nextCursor === null);

  useEffect(() => {
    if (isEmpty) return;

    if (typeof window.IntersectionObserver === "function") {
      let observer: IntersectionObserver | null = null;
      let resizeFrame: number | null = null;

      const connectObserver = () => {
        observer?.disconnect();
        boundaryIntersectingRef.current = { before: false, after: false };
        observer = new window.IntersectionObserver(handleIntersectionEntries, {
          root: null,
          rootMargin: infiniteListPrefetchRootMargin(window.innerHeight),
          threshold: 0,
        });
        intersectionObserverRef.current = observer;
        if (topSentinelElementRef.current) {
          observer.observe(topSentinelElementRef.current);
        }
        if (bottomSentinelElementRef.current) {
          observer.observe(bottomSentinelElementRef.current);
        }
        for (const element of chunkElementsRef.current.values()) {
          observer.observe(element);
        }
      };
      const handleViewportResize = () => {
        if (resizeFrame !== null) return;
        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = null;
          connectObserver();
        });
      };

      connectObserver();
      window.addEventListener("resize", handleViewportResize);
      return () => {
        window.removeEventListener("resize", handleViewportResize);
        if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
        observer?.disconnect();
        if (intersectionObserverRef.current === observer) {
          intersectionObserverRef.current = null;
        }
      };
    }

    window.addEventListener("scroll", scheduleGeometryCheck, { passive: true });
    window.addEventListener("resize", scheduleGeometryCheck);
    scheduleGeometryCheck();
    return () => {
      window.removeEventListener("scroll", scheduleGeometryCheck);
      window.removeEventListener("resize", scheduleGeometryCheck);
      if (fallbackFrameRef.current !== null) {
        window.cancelAnimationFrame(fallbackFrameRef.current);
        fallbackFrameRef.current = null;
      }
    };
  }, [handleIntersectionEntries, isEmpty, scheduleGeometryCheck]);

  useEffect(() => {
    const root = rootElementRef.current;
    if (isEmpty || !root) return;

    const recheckProtectedChunks = () => scheduleGeometryCheck();
    const recheckClosedDisclosure = (event: Event) => {
      const details = event.target;
      if (details instanceof HTMLDetailsElement && !details.open) {
        scheduleGeometryCheck();
      }
    };
    root.addEventListener("focusout", recheckProtectedChunks);
    root.addEventListener("toggle", recheckClosedDisclosure, true);
    return () => {
      root.removeEventListener("focusout", recheckProtectedChunks);
      root.removeEventListener("toggle", recheckClosedDisclosure, true);
    };
  }, [isEmpty, scheduleGeometryCheck]);

  useEffect(() => {
    if (isEmpty || typeof window.ResizeObserver !== "function") return;
    const observer = new window.ResizeObserver((entries) => {
      for (const entry of entries) {
        const chunkId = (entry.target as HTMLElement).dataset.infiniteChunkId;
        if (chunkId) updateMeasuredHeight(chunkId, entry.contentRect.height);
      }
    });
    resizeObserverRef.current = observer;
    for (const element of chunkElementsRef.current.values()) {
      observer.observe(element);
    }
    return () => {
      observer.disconnect();
      if (resizeObserverRef.current === observer)
        resizeObserverRef.current = null;
    };
  }, [isEmpty, updateMeasuredHeight]);

  useLayoutEffect(() => {
    restoreAnchor();
    if (typeof window.IntersectionObserver !== "function") {
      scheduleGeometryCheck();
      return;
    }
    for (const direction of ["before", "after"] as const) {
      if (!boundaryIntersectingRef.current[direction]) continue;
      window.requestAnimationFrame(() => {
        const element =
          direction === "before"
            ? topSentinelElementRef.current
            : bottomSentinelElementRef.current;
        if (
          element &&
          isWithinPrefetchBand(
            element.getBoundingClientRect(),
            window.innerHeight,
          )
        ) {
          loadDirectionRef.current(direction);
        } else {
          boundaryIntersectingRef.current[direction] = false;
        }
      });
    }
  }, [restoreAnchor, scheduleGeometryCheck, state.revision]);

  const rootRef = useCallback((node: HTMLElement | null) => {
    rootElementRef.current = node;
  }, []);
  const topSentinelRef = useCallback((node: HTMLElement | null) => {
    const previous = topSentinelElementRef.current;
    if (previous && previous !== node) {
      intersectionObserverRef.current?.unobserve(previous);
    }
    topSentinelElementRef.current = node;
    if (node) intersectionObserverRef.current?.observe(node);
  }, []);
  const bottomSentinelRef = useCallback((node: HTMLElement | null) => {
    const previous = bottomSentinelElementRef.current;
    if (previous && previous !== node) {
      intersectionObserverRef.current?.unobserve(previous);
    }
    bottomSentinelElementRef.current = node;
    if (node) intersectionObserverRef.current?.observe(node);
  }, []);
  const chunkRef = useCallback((chunkId: string, node: HTMLElement | null) => {
    const previous = chunkElementsRef.current.get(chunkId);
    if (previous && previous !== node) {
      intersectionObserverRef.current?.unobserve(previous);
      resizeObserverRef.current?.unobserve(previous);
    }
    if (!node) {
      chunkElementsRef.current.delete(chunkId);
      return;
    }
    chunkElementsRef.current.set(chunkId, node);
    intersectionObserverRef.current?.observe(node);
    resizeObserverRef.current?.observe(node);
  }, []);

  const shownCount = countItems(state.chunks);
  return {
    chunks: state.chunks,
    total: state.total,
    shownCount,
    isEmpty,
    isBusy: state.before.loading || state.after.loading,
    hasReachedStart: state.previousCursor === null,
    hasReachedEnd: state.nextCursor === null,
    before: state.before,
    after: state.after,
    liveMessage: state.liveMessage,
    rootRef,
    topSentinelRef,
    bottomSentinelRef,
    chunkRef,
    retryBefore: () => loadDirectionRef.current("before"),
    retryAfter: () => loadDirectionRef.current("after"),
  };
}

/* eslint-disable react-hooks/refs -- The headless hook intentionally returns callback refs beside render state. */
export function InfiniteList<T>({
  renderChunk,
  emptyFallback = null,
  className,
  chunkClassName,
  ariaLabel,
  contentRole = "list",
  showComplete,
  ...options
}: InfiniteListProps<T>) {
  const stream = useInfiniteList(options);
  if (stream.isEmpty) return <>{emptyFallback}</>;

  return (
    <div ref={stream.rootRef} aria-busy={stream.isBusy} data-infinite-list="">
      <p
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        role="status"
        data-infinite-list-status=""
      >
        {stream.liveMessage}
      </p>
      <BoundaryStatus
        direction="before"
        status={stream.before}
        messages={{ ...DEFAULT_MESSAGES, ...options.messages }}
        retry={stream.retryBefore}
      />
      <div
        ref={stream.topSentinelRef}
        data-infinite-boundary="before"
        data-infinite-list-sentinel="before"
        className="h-px"
        aria-hidden="true"
      />
      <div className={className} role={contentRole} aria-label={ariaLabel}>
        {stream.chunks.map((chunk, chunkIndex) => {
          const previousChunk = findNonEmptyChunk(
            stream.chunks,
            chunkIndex,
            -1,
          );
          const nextChunk = findNonEmptyChunk(stream.chunks, chunkIndex, 1);
          const context: InfiniteChunkRenderContext<T> = {
            chunkId: chunk.id,
            chunkIndex,
            isFirstChunk: chunkIndex === 0,
            isLastChunk: chunkIndex === stream.chunks.length - 1,
            previousItem: previousChunk?.items.at(-1),
            nextItem: nextChunk?.items[0],
          };
          return (
            <div
              key={chunk.id}
              ref={(node) => stream.chunkRef(chunk.id, node)}
              className={chunkClassName}
              role={contentRole === "list" ? "presentation" : undefined}
              data-infinite-chunk-id={chunk.id}
              data-infinite-list-chunk=""
            >
              {chunk.rendered ? (
                renderChunk(chunk.items, context)
              ) : (
                <div
                  data-infinite-spacer=""
                  data-infinite-list-spacer=""
                  aria-hidden="true"
                  style={{ height: chunk.measuredHeight ?? 0 }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div
        ref={stream.bottomSentinelRef}
        data-infinite-boundary="after"
        data-infinite-list-sentinel="after"
        className="h-px"
        aria-hidden="true"
      />
      <BoundaryStatus
        direction="after"
        status={stream.after}
        messages={{ ...DEFAULT_MESSAGES, ...options.messages }}
        retry={stream.retryAfter}
      />
      {stream.hasReachedEnd &&
        (showComplete ?? options.source.kind === "remote") && (
          <p className="py-5 text-center text-xs text-[var(--text-muted)]">
            {{ ...DEFAULT_MESSAGES, ...options.messages }.complete}
          </p>
        )}
    </div>
  );
}
/* eslint-enable react-hooks/refs */

function BoundaryStatus({
  direction,
  status,
  messages,
  retry,
}: {
  direction: ListLoadDirection;
  status: InfiniteListDirectionStatus;
  messages: InfiniteListMessages;
  retry: () => void;
}) {
  if (status.loading) {
    return (
      <p
        className="py-3 text-center text-xs text-[var(--text-muted)]"
        role="status"
      >
        {direction === "before"
          ? messages.loadingBefore
          : messages.loadingAfter}
      </p>
    );
  }
  if (!status.error) return null;
  return (
    <div
      className="flex items-center justify-center gap-3 py-3 text-xs text-[var(--status-danger)]"
      role="alert"
    >
      <span>
        {messages.loadFailed} {status.error}
      </span>
      <button
        type="button"
        onClick={retry}
        className="border border-[var(--border-default)] px-3 py-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-hover)]"
      >
        {direction === "before" ? messages.retryBefore : messages.retryAfter}
      </button>
    </div>
  );
}

function createInitialState<T>(
  source: InfiniteListSource<T>,
  generation: number,
): InfiniteListState<T> {
  const slice = getInitialSlice(source);
  return {
    chunks: slice.items.length
      ? [
          {
            id: `infinite-chunk-${generation}-0`,
            items: slice.items,
            rendered: true,
            measuredHeight: null,
          },
        ]
      : [],
    previousCursor: slice.previousCursor,
    nextCursor: slice.nextCursor,
    total: slice.total,
    before: IDLE_DIRECTION,
    after: IDLE_DIRECTION,
    liveMessage: "",
    revision: 0,
  };
}

function getInitialSlice<T>(source: InfiniteListSource<T>): ListSlice<T> {
  if (source.kind === "remote") return source.initialSlice;
  if (source.items.length === 0) {
    return {
      items: [],
      previousCursor: null,
      nextCursor: null,
      total: 0,
    };
  }
  const chunkSize = normalizeChunkSize(source.chunkSize);
  const chunkCount = Math.ceil(source.items.length / chunkSize);
  const requestedIndex = source.initialChunkIndex ?? 0;
  const index = Math.max(
    0,
    Math.min(requestedIndex, Math.max(0, chunkCount - 1)),
  );
  return getLocalSlice(source.items, chunkSize, index);
}

async function loadSlice<T>(
  source: InfiniteListSource<T>,
  direction: ListLoadDirection,
  cursor: string,
  signal: AbortSignal,
): Promise<ListSlice<T>> {
  if (source.kind === "local") {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const index = parseLocalCursor(cursor);
    return getLocalSlice(
      source.items,
      normalizeChunkSize(source.chunkSize),
      index,
    );
  }

  const url = new URL(source.endpoint, window.location.href);
  url.searchParams.delete("before");
  url.searchParams.delete("after");
  url.searchParams.set(direction, cursor);
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isObject(body) && typeof body.message === "string"
        ? body.message
        : `Request failed with status ${response.status}.`;
    const code =
      isObject(body) && isProblemCode(body.code) ? body.code : "query_failed";
    throw new InfiniteListSourceError(code, message);
  }
  if (!isListSlice(body))
    throw new Error("The server returned an invalid slice.");
  return body as ListSlice<T>;
}

function validatePinnedIdentity<T>(
  source: InfiniteListSource<T>,
  slice: ListSlice<T>,
) {
  if (source.kind !== "remote") return;
  const initial = source.initialSlice;
  if (
    initial.datasetVersionId !== undefined &&
    slice.datasetVersionId !== initial.datasetVersionId
  ) {
    throw new InfiniteListSourceError(
      "stream_mismatch",
      "The catalog dataset changed while loading this list.",
    );
  }
  if (
    initial.assetDatasetVersionId !== undefined &&
    slice.assetDatasetVersionId !== initial.assetDatasetVersionId
  ) {
    throw new InfiniteListSourceError(
      "stream_mismatch",
      "The asset dataset changed while loading this list.",
    );
  }
}

function getLocalSlice<T>(
  items: readonly T[],
  chunkSize: number,
  index: number,
): ListSlice<T> {
  const chunkCount = Math.ceil(items.length / chunkSize);
  if (index < 0 || index >= chunkCount) {
    throw new Error("The local list cursor is outside the available items.");
  }
  return {
    items: items.slice(index * chunkSize, (index + 1) * chunkSize),
    previousCursor: index > 0 ? makeLocalCursor(index - 1) : null,
    nextCursor: index + 1 < chunkCount ? makeLocalCursor(index + 1) : null,
    total: items.length,
  };
}

function normalizeChunkSize(chunkSize: number | undefined): number {
  if (chunkSize === undefined) return INFINITE_LIST_LOCAL_CHUNK_SIZE;
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new Error(
      "Local infinite-list chunkSize must be a positive integer.",
    );
  }
  return chunkSize;
}

function makeLocalCursor(index: number): string {
  return `local:${index}`;
}

function parseLocalCursor(cursor: string): number {
  const match = /^local:(\d+)$/.exec(cursor);
  if (!match) throw new Error("The local list cursor is invalid.");
  return Number(match[1]);
}

function getSourceIdentity<T>(
  source: InfiniteListSource<T>,
  getKey: (item: T) => StableKey,
): string {
  if (source.identity) return `${source.kind}:${source.identity}`;
  if (source.kind === "remote") {
    const slice = source.initialSlice;
    return [
      "remote",
      source.endpoint,
      slice.datasetVersionId ?? "",
      slice.assetDatasetVersionId ?? "",
      slice.total ?? "",
      slice.items.length ? normalizeKey(getKey(slice.items[0])) : "",
      slice.items.length ? normalizeKey(getKey(slice.items.at(-1)!)) : "",
    ].join("|");
  }
  return [
    "local",
    source.items.length,
    normalizeChunkSize(source.chunkSize),
    source.initialChunkIndex ?? 0,
    source.items.length ? normalizeKey(getKey(source.items[0])) : "",
    source.items.length ? normalizeKey(getKey(source.items.at(-1)!)) : "",
  ].join("|");
}

function collectKeys<T>(
  chunks: readonly InfiniteListChunk<T>[],
  getKey: (item: T) => StableKey,
): Set<string> {
  const keys = new Set<string>();
  for (const chunk of chunks) {
    for (const item of chunk.items) keys.add(normalizeKey(getKey(item)));
  }
  return keys;
}

function normalizeKey(key: StableKey): string {
  return `${typeof key}:${String(key)}`;
}

function countItems<T>(chunks: readonly InfiniteListChunk<T>[]): number {
  return chunks.reduce((total, chunk) => total + chunk.items.length, 0);
}

function findNonEmptyChunk<T>(
  chunks: readonly InfiniteListChunk<T>[],
  startIndex: number,
  step: -1 | 1,
): InfiniteListChunk<T> | undefined {
  for (
    let index = startIndex + step;
    index >= 0 && index < chunks.length;
    index += step
  ) {
    if (chunks[index].items.length) return chunks[index];
  }
  return undefined;
}

function isWithinPrefetchBand(rect: DOMRect, viewportHeight: number): boolean {
  const { before, after } = infiniteListPrefetchMargins(viewportHeight);
  return rect.bottom >= -before && rect.top <= viewportHeight + after;
}

function isListSlice(value: unknown): value is ListSlice<unknown> {
  if (!isObject(value) || !Array.isArray(value.items)) return false;
  return (
    isNullableString(value.previousCursor) &&
    isNullableString(value.nextCursor) &&
    (value.total === undefined ||
      (typeof value.total === "number" && Number.isSafeInteger(value.total))) &&
    (value.datasetVersionId === undefined ||
      typeof value.datasetVersionId === "string") &&
    (value.assetDatasetVersionId === undefined ||
      typeof value.assetDatasetVersionId === "string")
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class InfiniteListSourceError extends Error {
  constructor(
    readonly code: InfiniteListProblem["code"],
    message: string,
  ) {
    super(message);
    this.name = "InfiniteListSourceError";
  }
}

function isProblemCode(value: unknown): value is InfiniteListProblem["code"] {
  return (
    value === "invalid_request" ||
    value === "invalid_cursor" ||
    value === "stream_mismatch" ||
    value === "dataset_unavailable" ||
    value === "query_failed"
  );
}

function isStaleProblemCode(
  value: InfiniteListProblem["code"],
): value is InfiniteListStaleProblem["code"] {
  return (
    value === "invalid_cursor" ||
    value === "stream_mismatch" ||
    value === "dataset_unavailable"
  );
}
