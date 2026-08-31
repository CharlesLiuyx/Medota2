import {
  INFINITE_LIST_PREFETCH_VIEWPORTS_AFTER,
  INFINITE_LIST_PREFETCH_VIEWPORTS_BEFORE,
  INFINITE_LIST_SLICE_LIMIT,
  type InfiniteListProblem,
  type ListLoadDirection,
  type VersionedListSlice,
} from "./infinite-list";

export const CATALOG_SLICE_LIMIT = INFINITE_LIST_SLICE_LIMIT;
export const CATALOG_PREFETCH_VIEWPORTS_BEFORE =
  INFINITE_LIST_PREFETCH_VIEWPORTS_BEFORE;
export const CATALOG_PREFETCH_VIEWPORTS_AFTER =
  INFINITE_LIST_PREFETCH_VIEWPORTS_AFTER;

export type CatalogEntityKind = "heroes" | "abilities";
export type CatalogLoadDirection = ListLoadDirection;

export type CatalogSlice<T> = VersionedListSlice<T>;

export type CatalogStreamProblem = InfiniteListProblem;

export type {
  InfiniteListProblem,
  ListLoadDirection,
  ListSlice,
  VersionedListSlice,
} from "./infinite-list";
export {
  infiniteListPrefetchMargins,
  infiniteListPrefetchRootMargin,
} from "./infinite-list";
