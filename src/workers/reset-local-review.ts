import { runMigrations } from "@/server/db/run-migrations";
import { openVerifiedDatabase } from "@/server/environment/contract";

const expectedConfirmation = "medota2_local";

async function main(): Promise<void> {
  const confirmationIndex = process.argv.indexOf("--confirm");
  const confirmation =
    confirmationIndex >= 0 ? process.argv[confirmationIndex + 1] : undefined;
  if (confirmation !== expectedConfirmation) {
    throw new Error(
      "Local-review rebuild refused. Pass --confirm medota2_local explicitly.",
    );
  }

  const migrationDatabase = await openVerifiedDatabase({
    role: "migration",
    operation: "migrate",
    confirmation,
  });
  try {
    await runMigrations(migrationDatabase);
  } finally {
    await migrationDatabase.end();
  }

  const resetDatabase = await openVerifiedDatabase({
    role: "migration",
    operation: "reset",
    confirmation,
  });
  try {
    await resetDatabase.query(
      "TRUNCATE source_snapshots, import_runs, reference_snapshots CASCADE",
    );
  } finally {
    await resetDatabase.end();
  }
  console.log("Local-review catalog state rebuilt in medota2_local.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
