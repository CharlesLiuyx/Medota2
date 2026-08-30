import { requiredArgument } from "./cli-args";
import { prepareWorker } from "./worker-utils";

async function main(): Promise<void> {
  const candidate = requiredArgument("candidate");
  const { pool } = await prepareWorker();
  try {
    const version = await pool.query(
      `SELECT id, status, gate_status, review_status, gate_summary, source_counts,
         selector_version, selector_manifest_sha256, semantic_sha256, created_at, promoted_at
       FROM hero_catalog_dataset_versions WHERE id = $1`,
      [candidate],
    );
    if (!version.rowCount) throw new Error(`Unknown catalog ${candidate}.`);
    const diffs = await pool.query(
      `SELECT severity, diff_kind, entity_type, entity_key, field_name, before_value, after_value
       FROM catalog_semantic_diffs WHERE candidate_version_id = $1
       ORDER BY severity DESC, entity_type, entity_key, id`,
      [candidate],
    );
    console.log(
      JSON.stringify({ version: version.rows[0], diffs: diffs.rows }, null, 2),
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
