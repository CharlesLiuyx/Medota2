import { performance } from "node:perf_hooks";
import pg from "pg";
import { getDatabaseUrl } from "@/config/env";
import type { ImportIssue, ParsedHeroDataset } from "@/domain/heroes";
import { assertSchemaCurrent } from "@/server/db/migrations";

const { Pool } = pg;

export function createWorkerPool(target: "main" | "test" = "main"): pg.Pool {
  return new Pool({
    connectionString: getDatabaseUrl("worker", target),
    application_name: "medota2-data-worker",
    max: 4,
  });
}

export async function createImportRun(
  pool: pg.Pool,
  input: {
    sourceKind: "vpk" | "dotaconstants" | "comparison";
    commit: string;
    transformerVersion: string;
    targetSchemaVersion: string;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO import_runs
      (source_kind, status, stage, medota2_commit, transformer_version, target_schema_version)
     VALUES ($1, 'running', 'starting', $2, $3, $4)
     RETURNING id`,
    [
      input.sourceKind,
      input.commit,
      input.transformerVersion,
      input.targetSchemaVersion,
    ],
  );
  return result.rows[0].id;
}

export async function updateRunStage(
  pool: pg.Pool,
  runId: string,
  stage: string,
): Promise<void> {
  await pool.query(
    "UPDATE import_runs SET stage = $2 WHERE id = $1 AND status = 'running'",
    [runId, stage],
  );
}

export async function failImportRun(
  pool: pg.Pool,
  runId: string,
  stage: string,
  error: unknown,
  metrics: Record<string, unknown>,
  details?: {
    issues?: ImportIssue[];
    counts?: ParsedHeroDataset["counts"] | Record<string, number>;
  },
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const issues = details?.issues ?? [
    { severity: "blocking", code: "unhandled_import_error", message },
  ];
  await pool.query(
    `UPDATE import_runs
     SET status = 'failed', stage = $2, counts = $3::jsonb, issues = $4::jsonb,
         metrics = $5::jsonb, error_summary = $6, finished_at = now()
     WHERE id = $1`,
    [
      runId,
      stage,
      JSON.stringify(details?.counts ?? {}),
      JSON.stringify(issues),
      JSON.stringify(metrics),
      message.slice(0, 4000),
    ],
  );
  await pool.query("DELETE FROM hero_import_staging WHERE import_run_id = $1", [
    runId,
  ]);
  await pool.query(
    "DELETE FROM catalog_import_staging WHERE import_run_id = $1",
    [runId],
  );
}

export async function prepareWorker(target: "main" | "test" = "main"): Promise<{
  pool: pg.Pool;
  targetSchemaVersion: string;
}> {
  const pool = createWorkerPool(target);
  const targetSchemaVersion = await assertSchemaCurrent(pool);
  return { pool, targetSchemaVersion };
}

export function startMetrics(): {
  finish: (extra?: Record<string, unknown>) => Record<string, unknown>;
} {
  const wallStart = performance.now();
  const cpuStart = process.cpuUsage();
  return {
    finish(extra = {}) {
      const cpu = process.cpuUsage(cpuStart);
      return {
        wallClockMs: Math.round((performance.now() - wallStart) * 100) / 100,
        cpuUserMs: Math.round(cpu.user / 10) / 100,
        cpuSystemMs: Math.round(cpu.system / 10) / 100,
        peakRssBytes: process.resourceUsage().maxRSS * 1024,
        ...extra,
      };
    },
  };
}
