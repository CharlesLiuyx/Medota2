import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

let loaded = false;

export function loadLocalEnv(): void {
  if (loaded) return;
  loaded = true;

  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
}

const databaseUrl = z.string().url().startsWith("postgresql://");

export function getDatabaseUrl(
  role: "migration" | "worker" | "web",
  target: "main" | "test" = "main",
): string {
  loadLocalEnv();
  const key = `DATABASE_URL_${role.toUpperCase()}${target === "test" ? "_TEST" : ""}`;
  const parsed = databaseUrl.safeParse(process.env[key]);
  if (!parsed.success) {
    throw new Error(
      `${key} is required and must be a postgresql:// URL. Copy .env.example to .env.`,
    );
  }
  return parsed.data;
}

export function getRequiredPath(
  key: "DOTA_VPK_UPDATES_PATH" | "DOTACONSTANTS_PATH",
): string {
  loadLocalEnv();
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(
      `${key} is required. Configure it in .env; source paths are never hard-coded.`,
    );
  }
  return resolve(process.cwd(), value);
}
