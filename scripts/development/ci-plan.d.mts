import type { CheckTask } from "./check-plan.mjs";
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

export function browserMatrix(plan: {
  tasks: Array<Pick<CheckTask, "id" | "kind">>;
}): { include: Array<{ task: string; shard: string; index: number }> };
