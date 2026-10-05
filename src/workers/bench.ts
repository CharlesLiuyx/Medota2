import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  acquireLock,
  fingerprint,
  readJson,
  writeJson,
} from "@/development/runtime";
import { sampleInputs, type SampleResult } from "@/development/sample";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let iterations = 5;
  let input = resolve("tests/fixtures/vpk");
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--iterations") iterations = Number(args[++index]);
    else if (args[index] === "--input" && args[index + 1])
      input = resolve(args[++index]);
    else throw new Error(`Unknown benchmark option: ${args[index]}`);
  }
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000)
    throw new Error("--iterations must be 1..1000.");
  const release = await acquireLock("benchmark");
  const started = Date.now();
  const before = await fingerprint([...sampleInputs, input]);
  const results: SampleResult[] = [];
  let child: ReturnType<typeof spawn> | undefined;
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    child?.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    // Separate processes keep CPU work off the web server and avoid module-cache
    // differences between AI clients. Run serially for comparable measurements.
    for (let index = 0; index < iterations; index++) {
      if (interrupted) throw new Error("Benchmark cancelled.");
      const result = await new Promise<SampleResult>((accept, reject) => {
        child = spawn(
          process.execPath,
          ["--import", "tsx", "src/workers/run-development-sample.ts", input],
          { stdio: ["ignore", "ignore", "inherit", "ipc"] },
        );
        let output: SampleResult | undefined;
        child.once(
          "message",
          (message: { result?: SampleResult; error?: string }) => {
            if (message.error) reject(new Error(message.error));
            output = message.result;
          },
        );
        child.once("error", reject);
        child.once("close", (code) =>
          code === 0 && output
            ? accept(output)
            : reject(new Error(`Benchmark worker exited (${code}).`)),
        );
      });
      results.push(result);
      console.log(
        `[${index + 1}/${iterations}] parse ${result.durationMs} ms · peak ${result.peakMemoryMb} MB`,
      );
    }
    if (before !== (await fingerprint([...sampleInputs, input])))
      throw new Error(
        "Benchmark inputs changed during the run; result is stale.",
      );
    const times = results
      .map((result) => result.durationMs)
      .sort((a, b) => a - b);
    const report = {
      schemaVersion: 1,
      status: "passed",
      implementation: before,
      inputVersion: results[0].inputVersion,
      inputBytes: results[0].inputBytes,
      iterations,
      medianMs: times[Math.floor(times.length / 2)],
      p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
      peakMemoryMb: Math.max(...results.map((result) => result.peakMemoryMb)),
      elapsedMs: Date.now() - started,
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      createdAt: new Date().toISOString(),
    };
    const baselinePath = resolve(
      ".medota2/benchmarks",
      `${report.inputVersion}-${process.platform}-${process.arch}-${process.version}.json`,
    );
    const previous = await readJson<typeof report>(baselinePath);
    if (previous && report.medianMs > previous.medianMs * 1.25)
      console.log(
        `Timing increased from ${previous.medianMs} ms to ${report.medianMs} ms; rerun without competing workloads before drawing a conclusion.`,
      );
    await writeJson(
      resolve(".medota2/benchmarks/runs", `${Date.now()}.json`),
      report,
    );
    await writeJson(baselinePath, report);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await release();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
