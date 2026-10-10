import { runTestSuite, type TestRunSuite } from "@/testing/test-run-harness";
import { automaticStorageCleanup } from "@/development/storage";
import { normalizeTestRunnerArgs } from "@/development/test-runner-args";

async function main(): Promise<void> {
  const suite = process.argv[2] as TestRunSuite | undefined;
  if (!suite || !(["integration", "e2e", "verify"] as const).includes(suite)) {
    throw new Error("Usage: run-test-suite <integration|e2e|verify>.");
  }
  const runnerArgs = normalizeTestRunnerArgs(process.argv.slice(3)).filter(
    (arg) => arg !== "--fault-after-provision",
  );
  if (suite === "verify" && runnerArgs.length)
    throw new Error(
      "Use integration or e2e for runner filtering; verify is the explicit full diagnostic.",
    );
  const runRoot = await runTestSuite(suite, {
    faultAfterProvision: process.argv.includes("--fault-after-provision"),
    runnerArgs,
  });
  console.log(`Verification evidence: ${runRoot}`);
}

main()
  .finally(() => automaticStorageCleanup("tests"))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
