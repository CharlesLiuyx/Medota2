export const INFINITE_LIST_SLICE_LIMIT = 48;
export const INFINITE_LIST_LOCAL_CHUNK_SIZE = 24;
export const INFINITE_LIST_PREFETCH_VIEWPORTS_BEFORE = 7;
export const INFINITE_LIST_PREFETCH_VIEWPORTS_AFTER = 10;

export interface InfiniteListPrefetchMargins {
  before: number;
  after: number;
}

export function infiniteListPrefetchMargins(
  viewportHeight: number,
): InfiniteListPrefetchMargins {
  if (!Number.isFinite(viewportHeight) || viewportHeight < 0) {
    throw new Error("Infinite-list viewport height must be non-negative.");
  }
  return {
    before: Math.round(
      viewportHeight * INFINITE_LIST_PREFETCH_VIEWPORTS_BEFORE,
    ),
    after: Math.round(viewportHeight * INFINITE_LIST_PREFETCH_VIEWPORTS_AFTER),
  };
}

export function infiniteListPrefetchRootMargin(viewportHeight: number): string {
  const { before, after } = infiniteListPrefetchMargins(viewportHeight);
  return `${before}px 0px ${after}px 0px`;
}

export type ListLoadDirection = "before" | "after";

export interface ListSlice<T> {
  items: T[];
  previousCursor: string | null;
  nextCursor: string | null;
  total?: number;
  groupCounts?: Record<string, number>;
  datasetVersionId?: string;
  assetDatasetVersionId?: string;
}

export interface VersionedListSlice<T> extends ListSlice<T> {
  datasetVersionId: string;
  assetDatasetVersionId: string;
}

export interface InfiniteListProblem {
  code:
    | "invalid_request"
    | "invalid_cursor"
    | "stream_mismatch"
    | "dataset_unavailable"
    | "query_failed";
  message: string;
}
