import { readActiveSnapshot } from "@/config/data-sync-state";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/config/env";

export type PreviewDataSource = "development" | "local-review";

/** Prefer an already provisioned real snapshot; isolated fixtures stay available explicitly. */
export function choosePreviewDataSource(
  configured: string | undefined,
  hasLocalReview: boolean,
): PreviewDataSource {
  const selection = configured?.trim() || "auto";
  if (selection === "auto")
    return hasLocalReview ? "local-review" : "development";
  if (selection === "development" || selection === "local-review")
    return selection;
  throw new Error(
    "MEDOTA2_WORKBENCH_DATA must be auto, local-review or development.",
  );
}

export function getPreviewDataSource(): PreviewDataSource {
  loadLocalEnv();
  const active = readActiveSnapshot();
  if (active) return active.lease.environment;
  return choosePreviewDataSource(
    process.env.MEDOTA2_WORKBENCH_DATA,
    existsSync(
      resolve(
        ".medota2/environments/local-review/environment-identities.v1.json",
      ),
    ),
  );
}

export function previewEnvironment(
  source: PreviewDataSource,
): NodeJS.ProcessEnv {
  const active = readActiveSnapshot();
  const collectionPath = process.env.DOTA_MAP_COLLECTION_PATH ?? "";
  const dataPath = process.env.DOTA_MAP_DATA_PATH ?? "";
  // Applying a shared snapshot supersedes the old machine-local selection.
  // A newly configured immutable collection is a new local edit for both Web and export.
  const useAppliedMaps =
    active?.mapInputsAtApply &&
    active.mapInputsAtApply.collectionPath === collectionPath &&
    active.mapInputsAtApply.dataPath === dataPath;
  return {
    ...process.env,
    ...(active?.lease.environment === source
      ? {
          DOTA_VPK_WORKTREE_ROOT: active.sourceRoot,
          // Explicit local inputs are edits, and must be visible to both Web and sync.
          DOTA_MAP_DATA_PATH: useAppliedMaps
            ? (active.mapRoot ?? "")
            : (process.env.DOTA_MAP_DATA_PATH ?? active.mapRoot ?? ""),
          DOTA_MAP_COLLECTION_PATH: useAppliedMaps
            ? (active.mapCollectionPath ?? "")
            : (process.env.DOTA_MAP_COLLECTION_PATH ??
              (process.env.DOTA_MAP_DATA_PATH
                ? ""
                : (active.mapCollectionPath ?? ""))),
        }
      : {}),
    MEDOTA2_STATE_DIRECTORY:
      active?.lease.environment === source
        ? active.lease.stateDirectory
        : `.medota2/environments/${source}`,
    MEDOTA2_ENVIRONMENT: source,
    MEDOTA2_DATA_CLASS:
      source === "local-review" ? "production-snapshot" : "sandbox",
    MEDOTA2_DATABASE_CONFIRMATION:
      source === "local-review" ? "medota2_local" : "medota2",
  };
}
