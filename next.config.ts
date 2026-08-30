import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  devIndicators:
    process.env.NEXT_DIST_DIR?.trim() === ".next-e2e" ? false : undefined,
  output: "standalone",
  serverExternalPackages: ["pg"],
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
