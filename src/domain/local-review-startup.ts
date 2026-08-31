export interface LocalReviewBootstrapCandidate {
  gateStatus: string;
  reviewStatus: string;
  status: string;
}

export interface LocalReviewBootstrapDiff {
  severity: string;
  diffKind: string;
  entityType: string;
}

export interface LocalReviewBootstrapAssetCoverage {
  expectedHeroes: number;
  expectedAbilities: number;
  boundHeroes: number;
  boundAbilities: number;
  missingHeroes: number;
  missingAbilities: number;
  incompleteLods: number;
  generatedFallbacks: number;
  mismatches: number;
  errors: number;
}

export type LocalReviewBootstrapApproval =
  { approved: true } | { approved: false; reason: string };

export function evaluateLocalReviewBootstrapApproval(
  candidate: LocalReviewBootstrapCandidate,
  diffs: readonly LocalReviewBootstrapDiff[],
  coverage: LocalReviewBootstrapAssetCoverage,
): LocalReviewBootstrapApproval {
  if (
    candidate.gateStatus !== "yellow" ||
    candidate.reviewStatus !== "pending" ||
    candidate.status !== "candidate"
  ) {
    return {
      approved: false,
      reason: "the candidate is not pending Yellow review",
    };
  }

  if (
    diffs.length === 0 ||
    diffs.some(
      (diff) =>
        diff.severity !== "yellow" ||
        diff.entityType !== "asset" ||
        diff.diffKind !== "asset_provider_errors",
    )
  ) {
    return {
      approved: false,
      reason: "the candidate contains a non-asset-provider semantic diff",
    };
  }

  const coverageIsComplete =
    coverage.expectedHeroes > 0 &&
    coverage.expectedAbilities > 0 &&
    coverage.boundHeroes === coverage.expectedHeroes &&
    coverage.boundAbilities === coverage.expectedAbilities &&
    coverage.missingHeroes === 0 &&
    coverage.missingAbilities === 0 &&
    coverage.incompleteLods === 0;
  if (!coverageIsComplete) {
    return {
      approved: false,
      reason: "the retried asset dataset is not display-complete",
    };
  }

  if (
    coverage.generatedFallbacks !== 0 ||
    coverage.mismatches !== 0 ||
    coverage.errors !== 0
  ) {
    return {
      approved: false,
      reason: "the retried asset dataset is not fully native and error-free",
    };
  }

  return { approved: true };
}
