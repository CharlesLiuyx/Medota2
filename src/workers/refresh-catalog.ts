import { inspectReleaseReadiness } from "@/server/release-readiness";
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
  const { pool } = await prepareWorker("read");
  let portraitCommit: string | null = null;
  try {
    const active = await pool.query<{
      id: string;
      source_commit: string;
      portrait_commit: string | null;
    }>(
      `SELECT v.id, s.source_commit,
       (SELECT u.provenance->'images'->>'portraitCommit' FROM unit_asset_heads uh JOIN unit_asset_dataset_versions u ON u.id=uh.dataset_version_id WHERE uh.catalog_dataset_version_id=v.id) AS portrait_commit FROM dataset_heads h
       JOIN hero_catalog_dataset_versions v ON v.id = h.catalog_dataset_version_id
       JOIN source_snapshots s ON s.id = v.source_snapshot_id
       WHERE h.dataset_key = 'hero_catalog'`,
    );
    portraitCommit = active.rows[0]?.portrait_commit ?? null;
    if (
      active.rows[0]?.source_commit === commit &&
      (await inspectReleaseReadiness(pool, active.rows[0].id)).ready
    ) {
      await notifyCatalogEvent({ status: "no_change", commit });
      return;
    }
  } finally {
    await pool.end();
  }

  const locked = await createCatalogSourceLock(commit);
  const run = async (worker: string, args: string[]) => {
    const { stdout, stderr } = await execFileAsync(
      "pnpm",
      ["exec", "tsx", worker, ...args],
      { cwd: process.cwd(), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(stderr);
    return stdout;
  };
  const imported = JSON.parse(
    await run("src/workers/import-catalog.ts", [
      "--lock",
      locked.path,
      "--no-promote",
      "--download-missing",
    ]),
  ) as { catalogVersionId: string; gate: string; reviewStatus: string };
  const portraitIndex = process.argv.indexOf("--portrait-commit");
  if (portraitIndex >= 0)
    portraitCommit = process.argv[portraitIndex + 1] ?? null;
  await run("src/workers/import-unit-assets.ts", [
    "--catalog-version",
    imported.catalogVersionId,
    "--reuse-portraits",
    ...(portraitCommit ? ["--portrait-commit", portraitCommit] : []),
  ]);
  const { pool: coverageDb } = await prepareWorker("read");
  let coverage;
  try {
    coverage = await inspectReleaseReadiness(
      coverageDb,
      imported.catalogVersionId,
    );
  } finally {
    await coverageDb.end();
  }
  console.log(
    JSON.stringify({ candidate: imported.catalogVersionId, coverage }, null, 2),
  );
  if (!coverage.ready)
    throw new Error(`完整版本尚未就绪：${coverage.problems.join(" ")}`);
  if (imported.gate === "green" || imported.reviewStatus === "approved") {
    await run("src/workers/promote-catalog.ts", [
      "--candidate",
      imported.catalogVersionId,
    ]);
  }
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
