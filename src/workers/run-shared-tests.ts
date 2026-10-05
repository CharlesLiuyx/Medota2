import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { withTestEnvironment } from "@/development/test-environment";
import { run, fingerprint, writeJson } from "@/development/runtime";

async function main(): Promise<void> {
  const [suite, ...args] = process.argv.slice(2);
  if (!["integration", "e2e", "journeys", "clean"].includes(suite))
    throw new Error(
      "Usage: run-shared-tests <integration|e2e|journeys|clean> [test file / runner options]",
    );
  const shared =
    suite === "journeys" && !process.env.CI && !args.includes("--fixture");
  const forwarded = args.filter((arg) => arg !== "--fixture");
  const before = await fingerprint([
    "src",
    "tests",
    "drizzle",
    "package.json",
    "pnpm-lock.yaml",
    "playwright.config.ts",
    "playwright.shared.config.ts",
  ]);
  if (shared) {
    await run("pnpm", ["dev"]);
    const evidenceRoot = resolve(
      ".medota2/shared-tests/runs",
      `${Date.now()}-${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 8)}`,
    );
    const databaseBefore = await dataVersion();
    let result = "running";
    try {
      await run(
        "pnpm",
        [
          "exec",
          "playwright",
          "test",
          "--config",
          "playwright.shared.config.ts",
          ...forwarded,
        ],
        {
          ...process.env,
          MEDOTA2_SHARED_WEB: "1",
          MEDOTA2_ARTIFACT_ROOT: evidenceRoot,
          MEDOTA2_EXPECTED_DATA_VERSION: databaseBefore,
        },
        resolve(evidenceRoot, "runner.log"),
      );
      const after = await fingerprint([
        "src",
        "tests",
        "drizzle",
        "package.json",
        "pnpm-lock.yaml",
        "playwright.config.ts",
        "playwright.shared.config.ts",
      ]);
      result =
        before === after && databaseBefore === (await dataVersion())
          ? "passed"
          : "stale";
      if (result === "stale")
        throw new Error(
          "Related code or data changed during this test; rerun the affected check when stable.",
        );
    } catch (error) {
      if (result !== "stale") result = "failed";
      throw error;
    } finally {
      await writeJson(resolve(evidenceRoot, "run.json"), {
        status: result,
        input: before,
        dataVersion: databaseBefore,
        finishedAt: new Date().toISOString(),
      });
    }
    return;
  }
  await withTestEnvironment(
    async (env) => {
      if (suite === "integration")
        await run(
          "pnpm",
          [
            "exec",
            "vitest",
            "run",
            "--config",
            "vitest.integration.config.ts",
            ...forwarded,
          ],
          env,
          resolve(env.MEDOTA2_ARTIFACT_ROOT!, "runner.log"),
        );
      else
        await run(
          "pnpm",
          [
            "exec",
            "playwright",
            "test",
            "--config",
            suite === "journeys"
              ? "playwright.shared.config.ts"
              : "playwright.config.ts",
            ...(suite === "e2e" ? ["--project", "desktop-chromium"] : []),
            ...forwarded,
          ],
          env,
          resolve(env.MEDOTA2_ARTIFACT_ROOT!, "runner.log"),
        );
    },
    { seed: suite === "e2e" || suite === "journeys", clean: suite === "clean" },
  );
  if (
    suite !== "clean" &&
    before !==
      (await fingerprint([
        "src",
        "tests",
        "drizzle",
        "package.json",
        "pnpm-lock.yaml",
        "playwright.config.ts",
        "playwright.shared.config.ts",
      ]))
  )
    throw new Error(
      "Related inputs changed during verification; this result is stale.",
    );
}
async function dataVersion(): Promise<string> {
  const response = await fetch("http://127.0.0.1:3000/api/catalog/heroes", {
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Shared Catalog API is not ready.");
  const body = (await response.json()) as {
    datasetVersionId: string;
    assetDatasetVersionId: string;
  };
  return `${body.datasetVersionId}:${body.assetDatasetVersionId}`;
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
