import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CommandAbortedError, run } from "./runtime";
import { withTestEnvironment } from "./test-environment";
import { warmBrowserOrigin } from "./warm-browser";

/** One fixture lease and one owned Web process for sequential browser suites.
 * Each suite still creates fresh Playwright contexts and separate evidence. */
export async function withBrowserBatch(
  work: (env: NodeJS.ProcessEnv, signal: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await withTestEnvironment(
    async (environment) => {
      signal.throwIfAborted();
      const env: NodeJS.ProcessEnv = {
        ...environment,
        MEDOTA2_FIXTURE_BROWSER_BATCH: "1",
      };
      const port = Number(env.MEDOTA2_TEST_WEB_PORT);
      // Never attach to an unrelated service already occupying the leased port.
      await new Promise<void>((accept, reject) => {
        const probe = createServer();
        probe.once("error", reject);
        probe.listen(port, "127.0.0.1", () => probe.close(() => accept()));
      });
      const stop = new AbortController();
      const failed = new AbortController();
      const active = AbortSignal.any([signal, failed.signal]);
      const server = run(
        "pnpm",
        [
          "exec",
          "next",
          "dev",
          "--turbopack",
          "-H",
          "127.0.0.1",
          "-p",
          String(port),
        ],
        { ...env, MEDOTA2_PROCESS_ROLE: "web" },
        resolve(env.MEDOTA2_ARTIFACT_ROOT!, "web.log"),
        AbortSignal.any([signal, stop.signal]),
      ).then(
        () => {
          failed.abort(new Error("Fixture Web server exited unexpectedly."));
        },
        (error: unknown) => {
          if (!(stop.signal.aborted && error instanceof CommandAbortedError))
            failed.abort(error);
        },
      );
      try {
        const origin = `http://127.0.0.1:${port}`;
        const deadline = Date.now() + 120_000;
        for (;;) {
          active.throwIfAborted();
          const ready = await fetch(`${origin}/heroes`, {
            signal: AbortSignal.any([active, AbortSignal.timeout(5000)]),
          })
            .then(async (response) => {
              await response.arrayBuffer();
              return response.ok;
            })
            .catch(() => false);
          if (ready) break;
          if (Date.now() >= deadline)
            throw new Error("Fixture Web startup timed out.");
          await delay(200, undefined, { signal: active });
        }
        // Full union of warm routes, once; individual suites must not skip a route
        // needed by a later suite or reuse a marker from an earlier invocation.
        await warmBrowserOrigin(origin);
        active.throwIfAborted();
        await work(env, active);
        active.throwIfAborted();
      } finally {
        stop.abort();
        await server;
        // Cleanup errors are gates too; never publish passing evidence after an
        // owned process group could not be stopped.
        if (failed.signal.aborted) throw failed.signal.reason;
      }
    },
    { seed: true, signal },
  );
}
