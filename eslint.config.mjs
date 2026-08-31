import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/config/env.ts",
      "src/server/environment/contract.ts",
      "src/server/environment/isolate-local-stack.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "pg",
              message:
                "Application code must obtain an opaque verified database capability from the environment contract.",
            },
            {
              name: "@/config/env",
              importNames: ["getEnvironmentDatabaseUrl"],
              message:
                "Raw database URLs are private to the verified environment access module.",
            },
            {
              name: "@/config/database-credentials",
              message:
                "Runtime credential receipts are private to the environment adapters.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    ".next-e2e/**",
    ".next-local/**",
    ".next-preview/**",
    ".next-validation/**",
    ".medota2/**",
    "coverage/**",
    "dist/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);
