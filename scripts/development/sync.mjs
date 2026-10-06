import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

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
  await run("git", ["pull", "--ff-only"]);
  await run(process.execPath, [pnpm, "install", "--frozen-lockfile"]);
  await run(process.execPath, [
    "--import",
    "tsx",
    "src/workers/data-sync.ts",
    "apply",
    "--backup-local",
  ]);
  await run(process.execPath, [
    "--import",
    "tsx",
    "src/workers/dev.ts",
    "--restart",
  ]);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Workspace sync failed.",
  );
  process.exitCode = 1;
}
