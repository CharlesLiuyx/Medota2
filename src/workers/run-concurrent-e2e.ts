import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface ConcurrentRunManifest {
  runId: string;
  status: string;
  resources: {
    composeProject: string;
    databaseHostPort: number;
    webOrigin: string;
    stateDirectory: string;
    nextDistDirectory: string;
    nextTsconfig: string;
    artifactRoot: string;
  };
  cleanup: { status: string; databaseRetained: boolean };
}

interface CompletedRun {
  runRoot: string;
  manifest: ConcurrentRunManifest;
}

async function main(): Promise<void> {
  const completed = await Promise.all([runE2e(1), runE2e(2)]);
  assertIndependentResources(completed);
  console.log(
    JSON.stringify(
      {
        concurrentRuns: completed.map(({ runRoot, manifest }) => ({
          runId: manifest.runId,
          runRoot,
          composeProject: manifest.resources.composeProject,
          databaseHostPort: manifest.resources.databaseHostPort,
          webOrigin: manifest.resources.webOrigin,
          cleanup: manifest.cleanup.status,
        })),
      },
      null,
      2,
    ),
  );
}

async function runE2e(ordinal: number): Promise<CompletedRun> {
  return new Promise<CompletedRun>((resolveRun, rejectRun) => {
    const child = spawn(
      "pnpm",
      ["exec", "tsx", "src/workers/run-test-suite.ts", "e2e"],
      {
        cwd: process.cwd(),
        env: { ...process.env, CI: process.env.CI ?? "true" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const output = chunk.toString("utf8");
      stdout = (stdout + output).slice(-256_000);
      process.stdout.write(`[e2e-${ordinal}] ${output}`);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(`[e2e-${ordinal}] ${chunk.toString("utf8")}`);
    });
    child.once("error", rejectRun);
    child.once("close", async (code) => {
      if (code !== 0) {
        rejectRun(new Error(`Concurrent E2E run ${ordinal} exited ${code}.`));
        return;
      }
      try {
        const runRoot = parseEvidenceRoot(stdout);
        const manifest = JSON.parse(
          await readFile(resolve(runRoot, "run.json"), "utf8"),
        ) as ConcurrentRunManifest;
        if (
          manifest.status !== "passed" ||
          manifest.cleanup.status !== "cleaned" ||
          manifest.cleanup.databaseRetained
        ) {
          throw new Error(
            `Concurrent E2E run ${ordinal} did not finish cleanly.`,
          );
        }
        resolveRun({ runRoot, manifest });
      } catch (error) {
        rejectRun(error);
      }
    });
  });
}

function parseEvidenceRoot(stdout: string): string {
  const matches = [...stdout.matchAll(/^Verification evidence: (.+)$/gmu)];
  const value = matches.at(-1)?.[1]?.trim();
  if (!value) throw new Error("Concurrent E2E run did not report evidence.");
  return resolve(value);
}

function assertIndependentResources(runs: readonly CompletedRun[]): void {
  const resources = runs.map(({ runRoot, manifest }) => [
    runRoot,
    manifest.resources.composeProject,
    String(manifest.resources.databaseHostPort),
    manifest.resources.webOrigin,
    resolve(runRoot, manifest.resources.stateDirectory),
    resolve(runRoot, manifest.resources.nextDistDirectory),
    resolve(runRoot, manifest.resources.nextTsconfig),
    resolve(runRoot, manifest.resources.artifactRoot),
  ]);
  for (let index = 0; index < resources[0].length; index += 1) {
    if (new Set(resources.map((run) => run[index])).size !== runs.length) {
      throw new Error(
        `Concurrent E2E runs overlapped leased resource field ${index}.`,
      );
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
