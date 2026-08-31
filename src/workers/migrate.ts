import { getDatabaseConfirmation } from "@/config/env";
import { runMigrations } from "@/server/db/run-migrations";
import { openVerifiedDatabase } from "@/server/environment/contract";

async function main(): Promise<void> {
  const database = await openVerifiedDatabase({
    role: "migration",
    operation: "migrate",
    confirmation: getDatabaseConfirmation(),
  });
  try {
    const applied = await runMigrations(database);
    console.log(
      applied.length ? `applied ${applied.join(", ")}` : "database is current",
    );
  } finally {
    await database.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
