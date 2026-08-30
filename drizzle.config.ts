import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL_MIGRATION ??
      "postgresql://medota2_owner:medota2_owner@127.0.0.1:54321/medota2",
  },
  strict: true,
  verbose: true,
});
