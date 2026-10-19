import { writeFileSync } from "node:fs";
import { relative } from "node:path";
import type { Reporter, Suite } from "@playwright/test/reporter";

/** Small portable failure evidence, also uploaded with CI check receipts. */
export default class FailureReporter implements Reporter {
  private suite?: Suite;
  private failOnFlakyTests = false;
  onBegin(config: { failOnFlakyTests?: boolean }, suite: Suite) {
    this.failOnFlakyTests = Boolean(config.failOnFlakyTests);
    this.suite = suite;
  }
  onEnd() {
    const path = process.env.MEDOTA2_CHECK_FAILURE_FILE;
    if (!path) return;
    writeFileSync(
      `${path}.timings.json`,
      JSON.stringify(
        this.suite?.allTests().map((test) => ({
          file: relative(process.cwd(), test.location.file).replaceAll(
            "\\",
            "/",
          ),
          project: test.parent.project()?.name ?? "",
          titlePath: (() => {
            const titles = [test.title];
            for (
              let parent = test.parent;
              parent.type === "describe";
              parent = parent.parent!
            )
              titles.unshift(parent.title);
            return titles;
          })(),
          durationMs: test.results.reduce(
            (sum, result) => sum + result.duration,
            0,
          ),
          outcome: test.outcome(),
          attempts: test.results.length,
        })) ?? [],
        null,
        2,
      ) + "\n",
    );
    const failed =
      this.suite
        ?.allTests()
        .filter(
          (test) =>
            test.outcome() === "unexpected" ||
            (this.failOnFlakyTests && test.outcome() === "flaky"),
        ) ?? [];
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
