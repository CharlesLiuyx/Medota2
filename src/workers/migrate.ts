import { getDatabaseUrl } from "@/config/env";
import { runMigrations } from "@/server/db/run-migrations";

async function main(): Promise<void> {
  const applied = await runMigrations(getDatabaseUrl("migration"));
  console.log(
    applied.length ? `applied ${applied.join(", ")}` : "database is current",
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
