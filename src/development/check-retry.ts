import type {
  CheckPlan,
  CheckTask,
} from "../../scripts/development/check-plan.mjs";

export type FailedCase = { title: string; file: string; project: string };
export type FailedCheck = {
  schemaVersion: number;
  status: string;
  paths: string[];
  tasks: Array<{ id: string; status: string; failedCases?: FailedCase[] }>;
};

export function validateFailedCheck(value: unknown): FailedCheck {
  const receipt = value as FailedCheck | null;
  if (
    !receipt ||
    receipt.schemaVersion !== 1 ||
    !["failed", "interrupted"].includes(receipt.status) ||
    !Array.isArray(receipt.paths) ||
    !receipt.paths.every((path) => typeof path === "string") ||
    !Array.isArray(receipt.tasks) ||
    !receipt.tasks.some((task) => task.status === "failed")
  )
    throw new Error(
      "需要含失败任务的check收据；过期或通过的收据不能用于定向复验。",
    );
  return receipt;
}

/** Only select from freshly planned commands; receipt command/args are never executed. */
export function retryPlan(
  plan: CheckPlan,
  receipt: FailedCheck,
  fixtureOnly = false,
): CheckPlan {
  const tasks: CheckTask[] = [];
  for (const failed of receipt.tasks.filter(
    (task) => task.status === "failed",
  )) {
    const id = failed.id === "journeys-fixture" ? "journeys" : failed.id;
    const task = plan.tasks.find((candidate) => candidate.id === id);
    if (!task)
      throw new Error(
        `失败任务 ${id} 已不在当前计划中，请按当前范围重新检查。`,
      );
    let args = task.args;
    if (task.kind === "browser" && failed.failedCases?.length) {
      if (
        !failed.failedCases.every(
          (item) => typeof item.title === "string" && item.title.length > 0,
        )
      )
        throw new Error("失败用例证据无效。");
      const titles = [...new Set(failed.failedCases.map((item) => item.title))];
      // Keep file/project selection, replace only the broader scope grep. A renamed test
      // yields no tests (failure); no --pass-with-no-tests escape is accepted.
      args = args.filter(
        (arg, index) => arg !== "--grep" && args[index - 1] !== "--grep",
      );
      args = [
        ...args,
        "--grep",
        titles
          .map(
            (title) => `(?:${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})$`,
          )
          .join("|"),
      ];
    }
    if (id === "journeys" && !fixtureOnly)
      tasks.push({
        ...task,
        id: "journeys-fixture",
        args: [...args, "--fixture"],
      });
    tasks.push({ ...task, args });
  }
  return {
    ...plan,
    tasks: tasks.filter(
      (task, index) =>
        tasks.findIndex((other) => other.id === task.id) === index,
    ),
    browser: tasks.some((task) => task.kind === "browser"),
    database: tasks.some((task) =>
      ["browser", "database", "build"].includes(task.kind),
    ),
    summary: "失败任务定向复验；通过后仍须完成当前完整发布计划",
  };
}
