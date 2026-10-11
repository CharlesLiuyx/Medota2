import type { CheckPlan } from "./check-plan.mjs";
export function coreLanesForPlan(plan: CheckPlan): Array<"static" | "runtime">;
export function candidateBase(branch: string): string | undefined;
export function reusableCandidate(
  run: {
    head_sha: string;
    event: string;
    status: string;
    conclusion: string | null;
    workflow_id: number;
    head_repository?: { full_name: string };
    head_branch: string;
  },
  target: { sha: string; base: string; workflowId: number; repository: string },
): boolean;
