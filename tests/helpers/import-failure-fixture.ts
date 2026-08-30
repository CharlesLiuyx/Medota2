import pg from "pg";

const { Pool } = pg;

const FAILURE_TRANSFORMER_VERSION = "hero-vpk-v1/e2e-isolated-failure-scenario";

export async function insertImportFailureFixture(): Promise<string> {
  const pool = createTestPool();
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO import_runs
        (source_kind, status, stage, medota2_commit, transformer_version,
         target_schema_version, counts, issues, metrics, error_summary,
         started_at, finished_at)
       SELECT 'vpk', 'failed', 'parse_and_validate', $1, $2,
         target_schema_version, '{}'::jsonb,
         '[{"severity":"blocking","code":"fixture_failure","message":"Fixture failure"}]'::jsonb,
         '{"fixture":true,"isolated":true}'::jsonb,
         'Fixture failure kept the previous active dataset.', now(), now()
       FROM import_runs
       WHERE source_kind = 'vpk' AND status = 'succeeded'
       ORDER BY finished_at DESC NULLS LAST
       LIMIT 1
       RETURNING id`,
      ["8".repeat(40), FAILURE_TRANSFORMER_VERSION],
    );
    if (!result.rows[0]) {
      throw new Error(
        "The isolated failure scenario requires a successful VPK seed first.",
      );
    }
    return result.rows[0].id;
  } finally {
    await pool.end();
  }
}

export async function deleteImportFailureFixture(id: string): Promise<void> {
  const pool = createTestPool();
  try {
    await pool.query(
      `DELETE FROM import_runs
       WHERE id = $1 AND transformer_version = $2`,
      [id, FAILURE_TRANSFORMER_VERSION],
    );
  } finally {
    await pool.end();
  }
}

function createTestPool(): pg.Pool {
  const databaseUrl = process.env.DATABASE_URL_MIGRATION_TEST;
  if (!databaseUrl || !databaseUrl.includes("_test")) {
    throw new Error(
      "The isolated failure scenario requires DATABASE_URL_MIGRATION_TEST.",
    );
  }
  return new Pool({ connectionString: databaseUrl, max: 1 });
}
