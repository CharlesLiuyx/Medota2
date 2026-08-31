import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface ChildResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface IsolationManifest {
  runId: string;
  status: string;
  resources: {
    composeProject: string;
    databaseHostPort: number;
    webOrigin: string;
    nextTsconfig: string;
  };
  cleanup: { status: string; databaseRetained: boolean };
}

async function main(): Promise<void> {
  const [survivor, victim] = await Promise.all([
    runHarness("survivor", []),
    runHarness("victim", ["--fault-after-provision"]),
  ]);
  if (survivor.code !== 0) {
    throw new Error(`Isolation survivor exited ${survivor.code}.`);
  }
  if (victim.code === 0) {
    throw new Error("Injected failure run unexpectedly passed.");
  }

  const survivorRoot = parseSuccessRoot(survivor.stdout);
  const victimRoot = parseFailureRoot(victim.stderr);
  const [survivorManifest, victimManifest] = await Promise.all([
    readManifest(survivorRoot),
    readManifest(victimRoot),
  ]);
  assertRunState(survivorManifest, "passed");
  assertRunState(victimManifest, "failed");
  if (
    survivorRoot === victimRoot ||
    survivorManifest.resources.composeProject ===
      victimManifest.resources.composeProject ||
    survivorManifest.resources.databaseHostPort ===
      victimManifest.resources.databaseHostPort ||
    survivorManifest.resources.webOrigin ===
      victimManifest.resources.webOrigin ||
    resolve(survivorRoot, survivorManifest.resources.nextTsconfig) ===
      resolve(victimRoot, victimManifest.resources.nextTsconfig)
  ) {
    throw new Error("Failure-isolation probe detected an overlapping lease.");
  }

  console.log(
    JSON.stringify(
      {
        survivor: summarize(survivorRoot, survivorManifest),
        failedAndCleaned: summarize(victimRoot, victimManifest),
      },
      null,
      2,
    ),
  );
}

function runHarness(
  label: string,
  extraArgs: readonly string[],
): Promise<ChildResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      "pnpm",
      [
        "exec",
        "tsx",
        "src/workers/run-test-suite.ts",
        "integration",
        ...extraArgs,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, CI: process.env.CI ?? "true" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const output = chunk.toString("utf8");
      stdout = (stdout + output).slice(-256_000);
      process.stdout.write(`[${label}] ${output}`);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const output = chunk.toString("utf8");
      stderr = (stderr + output).slice(-256_000);
      process.stderr.write(`[${label}] ${output}`);
    });
    child.once("error", rejectRun);
    child.once("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

function parseSuccessRoot(stdout: string): string {
  const matches = [...stdout.matchAll(/^Verification evidence: (.+)$/gmu)];
  const value = matches.at(-1)?.[1]?.trim();
  if (!value) throw new Error("Survivor did not report verification evidence.");
  return resolve(value);
}

function parseFailureRoot(stderr: string): string {
  const matches = [...stderr.matchAll(/; see (.+\/index\.md)\.$/gmu)];
  const value = matches.at(-1)?.[1]?.trim();
  if (!value) throw new Error("Failed run did not report its evidence path.");
  return dirname(resolve(value));
}

async function readManifest(runRoot: string): Promise<IsolationManifest> {
  return JSON.parse(
    await readFile(resolve(runRoot, "run.json"), "utf8"),
  ) as IsolationManifest;
}

function assertRunState(
  manifest: IsolationManifest,
  expected: "passed" | "failed",
): void {
  if (
    manifest.status !== expected ||
    manifest.cleanup.status !== "cleaned" ||
    manifest.cleanup.databaseRetained
  ) {
    throw new Error(
      `${manifest.runId} did not finish as ${expected} with exact cleanup.`,
    );
  }
}

function summarize(runRoot: string, manifest: IsolationManifest) {
  return {
    runId: manifest.runId,
    runRoot,
    status: manifest.status,
    composeProject: manifest.resources.composeProject,
    databaseHostPort: manifest.resources.databaseHostPort,
    cleanup: manifest.cleanup.status,
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
