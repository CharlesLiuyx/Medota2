import type { PoolClient } from "pg";
import {
  assertSourceImportBuildIsClean,
  readBuildIdentity,
} from "@/config/build-identity";
import { getRequiredPath } from "@/config/env";
import {
  DOTACONSTANTS_SOURCE_PATHS,
  DOTACONSTANTS_SOURCE_REPOSITORY,
} from "@/importers/dotaconstants/constants";
import { parseReferenceHeroes } from "@/importers/dotaconstants/adapter";
import { inspectGitCheckout } from "@/importers/git-checkout";
import {
  createImportRun,
  failImportRun,
  prepareWorker,
  startMetrics,
  updateRunStage,
} from "./worker-utils";

async function main(): Promise<void> {
  const metrics = startMetrics();
  const build = await readBuildIdentity();
  const transformerVersion = `hero-reference-v1/${build.buildId}`;
  const { pool, targetSchemaVersion } = await prepareWorker();
  const runId = await createImportRun(pool, {
    sourceKind: "dotaconstants",
    commit: build.commit,
    transformerVersion,
    targetSchemaVersion,
  });
  let stage = "validate_build";

  try {
    assertSourceImportBuildIsClean(build);
    stage = "inspect_source";
    await updateRunStage(pool, runId, stage);
    const snapshot = await inspectGitCheckout(
      getRequiredPath("DOTACONSTANTS_PATH"),
      DOTACONSTANTS_SOURCE_PATHS,
    );
    const heroesFile = snapshot.files.find(
      (file) => file.path === "build/heroes.json",
    )!;
    const packageFile = snapshot.files.find(
      (file) => file.path === "package.json",
    )!;
    const packageJson = JSON.parse(packageFile.text) as { version?: unknown };
    if (
      typeof packageJson.version !== "string" ||
      packageJson.version.length === 0
    ) {
      throw new Error("dotaconstants package.json.version is required.");
    }
    const reference = parseReferenceHeroes(heroesFile.text);

    stage = "persist_reference";
    await updateRunStage(pool, runId, stage);
    const client = await pool.connect();
    let referenceSnapshotId: string;
    let idempotent = false;
    try {
      await client.query("BEGIN");
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO reference_snapshots
          (source_repository, source_remote_url, source_commit, source_dirty, source_inputs_match_head,
           package_version, heroes_sha256, package_sha256)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (source_repository, source_commit, heroes_sha256, package_sha256) DO NOTHING
         RETURNING id`,
        [
          DOTACONSTANTS_SOURCE_REPOSITORY,
          snapshot.remoteUrl,
          snapshot.commit,
          snapshot.dirty,
          snapshot.inputsMatchHead,
          packageJson.version,
          heroesFile.sha256,
          packageFile.sha256,
        ],
      );
      if (inserted.rowCount) {
        referenceSnapshotId = inserted.rows[0].id;
        await insertReferenceRecords(
          client,
          referenceSnapshotId,
          reference.heroes,
        );
      } else {
        idempotent = true;
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM reference_snapshots
           WHERE source_repository = $1 AND source_commit = $2 AND heroes_sha256 = $3 AND package_sha256 = $4`,
          [
            DOTACONSTANTS_SOURCE_REPOSITORY,
            snapshot.commit,
            heroesFile.sha256,
            packageFile.sha256,
          ],
        );
        referenceSnapshotId = existing.rows[0].id;
      }
      await client.query(
        `UPDATE import_runs
         SET status = 'succeeded', stage = 'complete', source_dirty = $2, source_inputs_match_head = $3,
             counts = $4::jsonb, issues = $5::jsonb, result_reference_snapshot_id = $6,
             metrics = $7::jsonb, finished_at = now()
         WHERE id = $1`,
        [
          runId,
          snapshot.dirty,
          snapshot.inputsMatchHead,
          JSON.stringify({
            accepted: reference.heroes.length,
            warnings: 0,
            blockingErrors: 0,
          }),
          JSON.stringify(reference.issues),
          referenceSnapshotId,
          JSON.stringify(
            metrics.finish({
              inputBytes: snapshot.files.reduce(
                (sum, file) => sum + file.sizeBytes,
                0,
              ),
              outputRecords: reference.heroes.length,
              idempotent,
            }),
          ),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    console.log(
      JSON.stringify(
        {
          runId,
          referenceSnapshotId,
          records: reference.heroes.length,
          sourceCommit: snapshot.commit,
          idempotent,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const possibleIssues = (error as { issues?: unknown }).issues;
    await failImportRun(pool, runId, stage, error, metrics.finish(), {
      issues: Array.isArray(possibleIssues) ? possibleIssues : undefined,
    });
    throw error;
  } finally {
    await pool.end();
  }
}

async function insertReferenceRecords(
  client: PoolClient,
  referenceSnapshotId: string,
  heroes: ReturnType<typeof parseReferenceHeroes>["heroes"],
): Promise<void> {
  for (const hero of heroes) {
    await client.query(
      `INSERT INTO reference_hero_records (reference_snapshot_id, hero_id, internal_name, raw_record)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        referenceSnapshotId,
        hero.heroId,
        hero.internalName,
        JSON.stringify(hero.raw),
      ],
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
