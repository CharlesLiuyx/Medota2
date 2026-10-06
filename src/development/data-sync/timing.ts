import { performance } from "node:perf_hooks";

/** stderr keeps internal task stdout available for its JSON result. */
export async function timed<T>(
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  console.error(`[sync] ${name}: started`);
  try {
    return await work();
  } finally {
    console.error(
      `[sync] ${name}: ${((performance.now() - start) / 1000).toFixed(2)}s`,
    );
  }
}
