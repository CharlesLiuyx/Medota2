import { CATALOG_IMPORT_LOCK_KEYS } from "@/importers/dota-vpk/constants";
import { requiredArgument } from "./cli-args";
import { prepareWorker } from "./worker-utils";

async function main(): Promise<void> {
  const candidate = requiredArgument("candidate");
  const { pool } = await prepareWorker();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ...CATALOG_IMPORT_LOCK_KEYS,
    ]);
    await client.query("SELECT promote_hero_catalog_version($1)", [candidate]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ candidate, promoted: true }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
