import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createCatalogSourceLock,
  discoverRemoteCommit,
  getCatalogSourceConfig,
} from "@/importers/catalog-source-lock";
import { notifyCatalogEvent } from "./catalog-notifications";
import { prepareWorker } from "./worker-utils";

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  const config = await getCatalogSourceConfig();
  const commit = await discoverRemoteCommit(config.remoteUrl);
  const { pool } = await prepareWorker();
  try {
    const active = await pool.query<{ source_commit: string }>(
      `SELECT s.source_commit FROM dataset_heads h
       JOIN hero_catalog_dataset_versions v ON v.id = h.catalog_dataset_version_id
       JOIN source_snapshots s ON s.id = v.source_snapshot_id
       WHERE h.dataset_key = 'hero_catalog'`,
    );
    if (active.rows[0]?.source_commit === commit) {
      await notifyCatalogEvent({ status: "no_change", commit });
      return;
    }
  } finally {
    await pool.end();
  }

  const locked = await createCatalogSourceLock(commit);
  const { stdout, stderr } = await execFileAsync(
    "pnpm",
    ["data:import:catalog", "--lock", locked.path],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
  await notifyCatalogEvent({ status: "succeeded", commit });
}

main().catch(async (error) => {
  const detail = error instanceof Error ? error.message : String(error);
  try {
    await notifyCatalogEvent({ status: "failed", detail });
  } catch (notificationError) {
    console.error(
      notificationError instanceof Error
        ? notificationError.message
        : notificationError,
    );
  }
  console.error(detail);
  process.exitCode = 1;
});
