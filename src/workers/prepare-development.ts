import { acquireLock, run } from "@/development/runtime";
import {
  persistentDataStackIsProvisioned,
  provisionDataStack,
  startPersistentDataStack,
} from "@/server/environment/data-stack-lifecycle";

async function main(): Promise<void> {
  const release = await acquireLock("development-database");
  try {
    process.env.MEDOTA2_STATE_DIRECTORY = ".medota2/environments/development";
    process.env.MEDOTA2_ENVIRONMENT = "development";
    process.env.MEDOTA2_DATA_CLASS = "sandbox";
    process.env.MEDOTA2_PROCESS_ROLE = "control";
    if (persistentDataStackIsProvisioned())
      await startPersistentDataStack("development");
    else
      await provisionDataStack({
        environment: "development",
        onProgress: console.log,
      });
    await run("pnpm", ["exec", "tsx", "src/workers/migrate.ts"], {
      ...process.env,
      MEDOTA2_PROCESS_ROLE: "migration",
    });
    await run(
      "pnpm",
      ["exec", "tsx", "tests/helpers/seed-test-database.ts", "--if-empty"],
      {
        ...process.env,
        MEDOTA2_PROCESS_ROLE: "migration",
        MEDOTA2_DATABASE_CONFIRMATION: "medota2",
      },
    );
  } finally {
    await release();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
