import type { CheckTask } from "../../scripts/development/check-plan.mjs";

/** Only real read-only journeys can overlap the fixture-backed build/smoke.
 * Fixture browsers, database contracts and benchmarks remain serialized. */
export function checkBatches(
  tasks: CheckTask[],
  parallelRealBuild: boolean,
): CheckTask[][] {
  const build = parallelRealBuild
    ? tasks.find((task) => task.id === "build" && task.kind === "build")
    : undefined;
  const real = parallelRealBuild
    ? tasks.find(
        (task) => task.id === "journeys" && !task.args.includes("--fixture"),
      )
    : undefined;
  const paired = build && real;
  return tasks.flatMap((task) => {
    if (paired && task === build) return [];
    if (paired && task === real) return [[task, build]];
    return [[task]];
  });
}
