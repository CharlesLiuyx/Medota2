import { fileURLToPath } from "node:url";
import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    // Concurrent Git/process fixtures can exhaust their deadline on Windows.
    maxWorkers:
      process.platform === "win32"
        ? Math.min(4, availableParallelism())
        : undefined,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      reportsDirectory:
        process.env.MEDOTA2_COVERAGE_DIRECTORY || "coverage/unit",
      thresholds: {
        branches: 45,
        functions: 50,
        lines: 50,
        statements: 50,
      },
    },
  },
});
