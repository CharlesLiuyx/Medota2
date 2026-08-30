import { loadLocalEnv } from "@/config/env";
import { runMigrations } from "@/server/db/run-migrations";

async function main(): Promise<void> {
  loadLocalEnv();
  const url = process.env.DATABASE_URL_MIGRATION_TEST;
  if (!url || !url.includes("_test")) {
    throw new Error(
      "DATABASE_URL_MIGRATION_TEST must point to an explicitly named test database.",
    );
  }
  const applied = await runMigrations(url);
  console.log(
    applied.length
      ? `applied ${applied.join(", ")}`
      : "test database is current",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
