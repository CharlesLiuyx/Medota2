import { describe, expect, it } from "vitest";
import { evaluateLocalReviewBootstrapApproval } from "@/domain/local-review-startup";

const candidate = {
  gateStatus: "yellow",
  reviewStatus: "pending",
  status: "candidate",
};

const completeCoverage = {
  expectedHeroes: 127,
  expectedAbilities: 2703,
  boundHeroes: 127,
  boundAbilities: 2703,
  missingHeroes: 0,
  missingAbilities: 0,
  incompleteLods: 0,
  generatedFallbacks: 0,
  mismatches: 0,
  errors: 0,
};

describe("local-review one-command bootstrap approval", () => {
  it("allows only a retried asset-provider-only Yellow candidate", () => {
    expect(
      evaluateLocalReviewBootstrapApproval(
        candidate,
        [
          {
            severity: "yellow",
            diffKind: "asset_provider_errors",
            entityType: "asset",
          },
        ],
        completeCoverage,
      ),
    ).toEqual({ approved: true });
  });

  it("keeps gameplay and source changes behind manual review", () => {
    expect(
      evaluateLocalReviewBootstrapApproval(
        candidate,
        [
          {
            severity: "yellow",
            diffKind: "hero_removed",
            entityType: "hero",
          },
        ],
        completeCoverage,
      ),
    ).toMatchObject({ approved: false });
  });

  it("rejects incomplete, generated, mismatched, or errored assets", () => {
    for (const coverage of [
      { ...completeCoverage, missingAbilities: 1 },
      { ...completeCoverage, incompleteLods: 1 },
      { ...completeCoverage, generatedFallbacks: 1 },
      { ...completeCoverage, mismatches: 1 },
      { ...completeCoverage, errors: 1 },
    ]) {
      expect(
        evaluateLocalReviewBootstrapApproval(
          candidate,
          [
            {
              severity: "yellow",
              diffKind: "asset_provider_errors",
              entityType: "asset",
            },
          ],
          coverage,
        ),
      ).toMatchObject({ approved: false });
    }
  });
});
