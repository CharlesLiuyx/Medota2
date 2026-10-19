import type { CheckTask } from "../../scripts/development/check-plan.mjs";

/** Stages are barriers; chains within a stage overlap, tasks within a chain do not.
 * Real journeys only read the workbench. The other chain owns the fixture, so
 * build/smoke, fixture browsers and database contracts never overlap each other.
 * Benchmarks and unknown task kinds remain behind the join barrier. */
export function checkStages(
  tasks: CheckTask[],
  parallelRealBuild: boolean,
): CheckTask[][][] {
  const serial = (items: CheckTask[]) => items.map((task) => [[task]]);
  const build = parallelRealBuild
    ? tasks.find((task) => task.id === "build" && task.kind === "build")
    : undefined;
  const real = parallelRealBuild
    ? tasks.find(
        (task) => task.id === "journeys" && !task.args.includes("--fixture"),
      )
    : undefined;
  if (!build || !real) return serial(tasks);
  const remaining = tasks.filter((task) => task !== build);
  const index = remaining.indexOf(real);
  const following = remaining.slice(index + 1);
  const barrier = following.findIndex(
    (task) => !["browser", "database"].includes(task.kind),
  );
  const boundary = barrier < 0 ? following.length : barrier;
  return [
    ...serial(remaining.slice(0, index)),
    [[real], [build, ...following.slice(0, boundary)]],
    ...serial(following.slice(boundary)),
  ];
}
