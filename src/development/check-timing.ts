import { appendFileSync } from "node:fs";

/** Append-only phases survive failed preparation and belong to the check run. */
export type MeasureCheckPhase = <T>(
  phase: string,
  work: () => Promise<T>,
) => Promise<T>;

export const unmeasured: MeasureCheckPhase = (_phase, work) => work();

export function checkPhaseTimer(path: string): MeasureCheckPhase {
  return async (phase, work) => {
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let status = "failed";
    try {
      const result = await work();
      status = "passed";
      return result;
    } finally {
      const durationMs = Math.round(performance.now() - started);
      appendFileSync(
        path,
        JSON.stringify({ phase, startedAt, durationMs, status }) + "\n",
      );
      console.log(`[phase] ${phase}: ${durationMs}ms (${status})`);
    }
  };
}
