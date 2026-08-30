import { requiredArgument } from "./cli-args";
import { prepareWorker } from "./worker-utils";

async function main(): Promise<void> {
  const candidate = requiredArgument("candidate");
  const decision = requiredArgument("decision");
  const reason = requiredArgument("reason");
  if (decision !== "approved" && decision !== "rejected") {
    throw new Error("--decision must be approved or rejected.");
  }
  const { pool } = await prepareWorker();
  try {
    await pool.query("SELECT review_hero_catalog_version($1, $2, $3)", [
      candidate,
      decision,
      reason,
    ]);
    console.log(JSON.stringify({ candidate, decision, reason }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
