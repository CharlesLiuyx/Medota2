import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // Windows re-reads native ACLs for every database admission. The setup
    // opens six independently verified roles; keep those checks in the budget.
    ...(process.platform === "win32"
      ? { hookTimeout: 60_000, testTimeout: 30_000 }
      : {}),
  },
});
