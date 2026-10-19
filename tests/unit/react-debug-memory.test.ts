import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { adaptReactDebugRuntime } from "../../scripts/development/react-debug-memory.mjs";

const require = createRequire(import.meta.url);
const compatUrl = pathToFileURL(
  resolve("scripts/development/react-debug-memory.mjs"),
).href;

describe("React development memory compatibility", () => {
  it("loads the real dev runtimes without retaining async history, while request context and other hooks still work", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--expose-gc",
        "--input-type=module",
        "-e",
        `
import { installReactDebugMemoryCompat } from ${JSON.stringify(compatUrl)};
import { createRequire } from 'node:module';
import asyncHooks from 'node:async_hooks';
const require = createRequire(import.meta.url);
const createHook = asyncHooks.createHook;
let matched = 0, enabled = 0, disabled = 0, otherEvents = 0;
asyncHooks.createHook = function(callbacks) {
  const hook = createHook(callbacks);
  if (String(callbacks.init).includes('pendingOperations')) {
    matched++;
    const enable = hook.enable, disable = hook.disable;
    hook.enable = function() { enabled++; return enable.call(this); };
    hook.disable = function() { disabled++; return disable.call(this); };
  }
  return hook;
};
installReactDebugMemoryCompat('phase-development-server');
installReactDebugMemoryCompat('phase-development-server');
require('next/dist/server/node-environment-baseline');
for (const name of ['app-page-turbo.runtime.dev.js', 'app-page.runtime.dev.js'])
  require('next/dist/compiled/next-server/' + name);
const context = new asyncHooks.AsyncLocalStorage();
const observer = asyncHooks.createHook({init() {otherEvents++;}}).enable();
const values = await Promise.all([1, 2, 3].map(value => context.run(value, async () => {
  await new Promise(resolve => setImmediate(resolve));
  return context.getStore();
})));
observer.disable();
global.gc();
const baseline = process.memoryUsage().heapUsed;
let release, ready;
const gate = new Promise(resolve => { release = resolve; });
const reached = new Promise(resolve => { ready = resolve; });
const longLived = (async () => {
  for (let i = 0; i < 20000; i++) {
    await Promise.resolve();
    await Promise.resolve();
    if (i % 100 === 0) await new Promise(resolve => setImmediate(resolve));
  }
  ready();
  await gate;
})();
await reached;
global.gc();
await new Promise(resolve => setImmediate(resolve));
global.gc();
const growth = process.memoryUsage().heapUsed - baseline;
release();
await longLived;
console.log(JSON.stringify({ matched, enabled, disabled, otherEvents, values, growth,
  loaded: [...globalThis[Symbol.for('medota2.react-debug-memory.v1')].loaded] }));
`,
      ],
      {
        env: { ...process.env, NODE_ENV: "development", NODE_OPTIONS: "" },
        encoding: "utf8",
        timeout: 20_000,
      },
    );
    const result = JSON.parse(output.trim());
    expect(result.matched).toBe(2);
    expect(result.enabled).toBe(0);
    expect(result.disabled).toBe(2);
    expect(result.otherEvents).toBeGreaterThan(0);
    expect(result.values).toEqual([1, 2, 3]);
    expect(result.loaded).toHaveLength(2);
    expect(result.growth).toBeLessThan(8 * 1024 * 1024);
  });

  it("does not install a loader for production", () => {
    const output = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { installReactDebugMemoryCompat } from ${JSON.stringify(compatUrl)};
installReactDebugMemoryCompat('phase-production-build');
installReactDebugMemoryCompat('phase-production-server');
console.log(Boolean(globalThis[Symbol.for('medota2.react-debug-memory.v1')]));`,
      ],
      {
        env: { ...process.env, NODE_ENV: "production", NODE_OPTIONS: "" },
        encoding: "utf8",
      },
    );
    expect(output.trim()).toBe("false");
  });

  it("accepts only the reviewed framework bytes and leaves installed files intact", () => {
    for (const name of [
      "app-page-turbo.runtime.dev.js",
      "app-page.runtime.dev.js",
      "app-page-experimental.runtime.dev.js",
      "app-page-turbo-experimental.runtime.dev.js",
    ]) {
      const path = require.resolve(`next/dist/compiled/next-server/${name}`);
      const source = readFileSync(path, "utf8");
      expect(adaptReactDebugRuntime(source, name)).not.toBe(source);
      expect(readFileSync(path, "utf8")).toBe(source);
      expect(() => adaptReactDebugRuntime(`${source}\n`, name)).toThrow(
        "needs review",
      );
      expect(() =>
        adaptReactDebugRuntime(source, name.replace(".dev.", ".prod.")),
      ).toThrow("needs review");
    }
  });
});
