export const CATALOG_DATASET_KEY = "hero_catalog" as const;
export const CATALOG_SELECTOR_VERSION = "hero-catalog-selector-v1" as const;

export const CATALOG_GATE_STATUSES = ["green", "yellow", "red"] as const;
export const CATALOG_REVIEW_STATUSES = [
  "not_required",
  "pending",
  "approved",
  "rejected",
] as const;

export type CatalogGateStatus = (typeof CATALOG_GATE_STATUSES)[number];
export type CatalogReviewStatus = (typeof CATALOG_REVIEW_STATUSES)[number];

export interface CatalogGateDecision {
  gateStatus: CatalogGateStatus;
  reviewStatus: CatalogReviewStatus;
  reasons: CatalogGateReason[];
}

export interface CatalogGateReason {
  code: string;
  severity: "warning" | "blocking";
  message: string;
  entityType?: "hero" | "ability" | "facet" | "localization" | "asset";
  entityKey?: string;
  sourcePath?: string;
}

export type CatalogDiffType = "added" | "removed" | "changed";

export interface CatalogSemanticDiff {
  entityType:
    "hero" | "ability" | "binding" | "facet" | "localization" | "source_file";
  entityKey: string;
  fieldName: string;
  diffType: CatalogDiffType;
  severity: "info" | "review" | "blocking";
  before: unknown;
  after: unknown;
}
