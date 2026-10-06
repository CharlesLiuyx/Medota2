import type { NextConfig } from "next";
import { readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const nextTsconfigPath = process.env.MEDOTA2_NEXT_TSCONFIG?.trim();

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  devIndicators: process.env.MEDOTA2_ENVIRONMENT === "test" ? false : undefined,
  output: "standalone",
  adapterPath: resolve("scripts/development/build-output.mjs"),
  // Reuse recently visited/prefetched catalog pages during quick navigation.
  // Refresh still reads the current published dataset immediately.
  experimental: { staleTimes: { dynamic: 300, static: 300 } },
  outputFileTracingExcludes: {
    "/*": [".env*", ".git/**/*", ...localStateExcludes()],
  },
  serverExternalPackages: ["pg"],
  allowedDevOrigins: ["127.0.0.1"],
  typescript: nextTsconfigPath
    ? {
        tsconfigPath: nextTsconfigPath,
      }
    : undefined,
};

// Keep generated runtime files from the active dist directory, while excluding
// local credentials, snapshots and other builds from standalone tracing.
function localStateExcludes(): string[] {
  const dist = resolve(process.env.NEXT_DIST_DIR?.trim() || ".next");
  const excluded: string[] = [];
  function visit(path: string): void {
    const absolute = resolve(path);
    if (absolute === dist) {
      excluded.push(`${path}/cache/**/*`, `${path}/standalone/**/*`);
      return;
    }
    if (!dist.startsWith(`${absolute}${sep}`)) {
      excluded.push(`${path.replaceAll("\\", "/")}/**/*`);
      return;
    }
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else excluded.push(child);
    }
  }
  for (const entry of readdirSync(process.cwd(), { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      (entry.name === ".medota2" || entry.name.startsWith(".next"))
    )
      visit(relative(process.cwd(), resolve(entry.name)));
  }
  return excluded;
}

export default nextConfig;
