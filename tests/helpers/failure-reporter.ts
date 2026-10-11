import { writeFileSync } from "node:fs";
import type { Reporter, Suite } from "@playwright/test/reporter";

/** Small portable failure evidence, also uploaded with CI check receipts. */
export default class FailureReporter implements Reporter {
  private suite?: Suite;
  onBegin(_config: unknown, suite: Suite) {
    this.suite = suite;
  }
  onEnd() {
    const path = process.env.MEDOTA2_CHECK_FAILURE_FILE;
    if (!path) return;
    const failed =
      this.suite
        ?.allTests()
        .filter((test) => test.outcome() === "unexpected") ?? [];
    writeFileSync(
      path,
      JSON.stringify(
        failed.map((test) => ({
          title: test.title,
          file: test.location.file,
          project: test.parent.project()?.name ?? "",
        })),
        null,
        2,
      ),
    );
  }
}
