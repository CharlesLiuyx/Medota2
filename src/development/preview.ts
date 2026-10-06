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
  return {
    ...process.env,
    ...(active?.lease.environment === source
      ? {
          DOTA_VPK_WORKTREE_ROOT: active.sourceRoot,
          DOTA_MAP_DATA_PATH: active.mapRoot ?? "",
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
