import { performance } from "node:perf_hooks";
import { getDatabaseConfirmation } from "@/config/env";
import type { DatabaseOperation } from "@/domain/environment";
import type { ImportIssue, ParsedHeroDataset } from "@/domain/heroes";
import { assertSchemaCurrent } from "@/server/db/migrations";
import {
  openVerifiedDatabase,
  type VerifiedDatabase,
} from "@/server/environment/contract";

type WorkerOperation = Extract<
  DatabaseOperation,
  "read" | "import" | "review" | "promote" | "rollback"
>;

type WorkerMutationOperation = Exclude<WorkerOperation, "read">;

export async function createImportRun(
  pool: VerifiedDatabase<"import">,
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
  pool: VerifiedDatabase<"import">,
  runId: string,
  stage: string,
): Promise<void> {
  await pool.query(
    "UPDATE import_runs SET stage = $2 WHERE id = $1 AND status = 'running'",
    [runId, stage],
  );
}

export async function failImportRun(
  pool: VerifiedDatabase<"import">,
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

interface PreparedWorker<Operation extends WorkerOperation> {
  pool: VerifiedDatabase<Operation>;
  targetSchemaVersion: string;
}

export function prepareWorker(
  operation: "read",
): Promise<PreparedWorker<"read">>;
export function prepareWorker<Operation extends WorkerMutationOperation>(
  operation: Operation,
): Promise<PreparedWorker<Operation>>;
export async function prepareWorker(
  operation: WorkerOperation,
): Promise<PreparedWorker<WorkerOperation>> {
  const pool: VerifiedDatabase<WorkerOperation> =
    operation === "read"
      ? await openVerifiedDatabase({ role: "web", operation: "read" })
      : await openVerifiedDatabase({
          role: "worker",
          operation: operation satisfies WorkerMutationOperation,
          confirmation: getDatabaseConfirmation(),
        });
  try {
    const targetSchemaVersion = await assertSchemaCurrent(pool);
    return { pool, targetSchemaVersion };
  } catch (error) {
    await pool.end();
    throw error;
  }
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
