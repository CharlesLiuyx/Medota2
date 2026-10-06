import { spawn, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";

const started = performance.now();

function run(command, args) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? accept() : reject(new Error(`${command} failed (${code}).`)),
    );
  });
}
try {
  const pnpm = process.env.npm_execpath;
  if (!pnpm || !existsSync(pnpm))
    throw new Error("Run this workflow with pnpm sync.");
  const before = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  await run("git", ["pull", "--ff-only"]);
  const after = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  await run(process.execPath, [pnpm, "install", "--frozen-lockfile"]);
  await run(process.execPath, [
    "--import",
    "tsx",
    "src/workers/data-sync.ts",
    "apply",
    "--backup-local",
    ...(before !== after ? ["--restart-workbench"] : []),
  ]);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Workspace sync failed.",
  );
  process.exitCode = 1;
} finally {
  console.error(
    `[sync] total: ${((performance.now() - started) / 1000).toFixed(2)}s`,
  );
}
