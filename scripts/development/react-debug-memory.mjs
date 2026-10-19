import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// React #36836: the development async debugger retains unbounded previous/awaited
// ancestry for long-lived tasks. This stops ONLY that optional debug hook.
// Request AsyncLocalStorage, other async hooks, error stacks and HMR remain active.
// Keep the adaptation in memory: never rewrite installed or production modules.
const fingerprints = {
  "app-page-experimental.runtime.dev.js":
    "8292778996dbc3d6601f67beb6133474af1dac76674010827976c0b5d6e5bebd",
  "app-page-turbo-experimental.runtime.dev.js":
    "94a9498b621aa9b819e5d6c302b2a5380aea36afcf05ef9c6e93aad7b47cfd24",
  "app-page-turbo.runtime.dev.js":
    "07ef32c3a1fe260ed1d60b32ae02b35adeede10b6d01d3df07b4fe5d24cdf5ea",
  "app-page.runtime.dev.js":
    "756f10f63e4fc0d03a0fced75a98932c828bf2a996586bd60da1972417a496a7",
};
const activation =
  "destroy:function(asyncId){pendingOperations.delete(asyncId)}}).enable()";
const marker = Symbol.for("medota2.react-debug-memory.v1");

/** @param {string} source @param {string} filename */
export function adaptReactDebugRuntime(source, filename) {
  const expected = fingerprints[filename];
  if (
    !expected ||
    createHash("sha256").update(source).digest("hex") !== expected ||
    source.split(activation).length !== 2
  )
    throw new Error(
      `React memory compatibility needs review for ${filename}; verify the installed Next version and rerun the memory regression before adapting it.`,
    );
  return source.replace(
    activation,
    activation.replace(".enable()", ".disable()"),
  );
}

/** Install only while Next is starting a development server. @param {string} phase */
export function installReactDebugMemoryCompat(phase) {
  if (phase !== "phase-development-server") return;
  if (globalThis[marker]) return;
  if (typeof nodeModule.registerHooks !== "function")
    throw new Error("The development memory fix requires Node 22.15+ or 24+.");
  const require = nodeModule.createRequire(import.meta.url);
  const packagePath = require.resolve("next/package.json");
  const version = JSON.parse(readFileSync(packagePath, "utf8")).version;
  if (version !== "16.3.3")
    throw new Error(
      `Review the React development memory compatibility before using Next ${version}.`,
    );
  const targets = new Map(
    Object.keys(fingerprints).map((name) => [
      pathToFileURL(
        resolve(dirname(packagePath), "dist/compiled/next-server", name),
      ).href,
      name,
    ]),
  );
  const loaded = new Set();
  nodeModule.registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      const filename = targets.get(url);
      if (!filename) return result;
      const source =
        typeof result.source === "string"
          ? result.source
          : result.source
            ? Buffer.from(result.source).toString("utf8")
            : readFileSync(fileURLToPath(url), "utf8");
      const adapted = adaptReactDebugRuntime(source, filename);
      loaded.add(filename);
      return { ...result, source: adapted };
    },
  });
  globalThis[marker] = { nextVersion: version, loaded };
}
