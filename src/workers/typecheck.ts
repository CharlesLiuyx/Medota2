import { acquireLock, run } from "@/development/runtime";

const release = await acquireLock("types");
try {
  await run("pnpm", [
    "exec",
    "tsc",
    "--noEmit",
    "--project",
    "tsconfig.check.json",
  ]);
} finally {
  await release();
}
