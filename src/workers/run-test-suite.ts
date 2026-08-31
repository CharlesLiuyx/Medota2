import { runTestSuite, type TestRunSuite } from "@/testing/test-run-harness";

async function main(): Promise<void> {
  const suite = process.argv[2] as TestRunSuite | undefined;
  if (!suite || !(["integration", "e2e", "verify"] as const).includes(suite)) {
    throw new Error("Usage: run-test-suite <integration|e2e|verify>.");
  }
  const runRoot = await runTestSuite(suite, {
    faultAfterProvision: process.argv.includes("--fault-after-provision"),
  });
  console.log(`Verification evidence: ${runRoot}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
