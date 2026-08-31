import type { NextConfig } from "next";

const nextTsconfigPath = process.env.MEDOTA2_NEXT_TSCONFIG?.trim();

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR?.trim() || ".next",
  devIndicators: process.env.MEDOTA2_ENVIRONMENT === "test" ? false : undefined,
  output: "standalone",
  serverExternalPackages: ["pg"],
  allowedDevOrigins: ["127.0.0.1"],
  typescript: nextTsconfigPath
    ? {
        tsconfigPath: nextTsconfigPath,
      }
    : undefined,
};

export default nextConfig;
