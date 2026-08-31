import { spawn } from "node:child_process";
import {
  evaluateLocalReviewBootstrapApproval,
  type LocalReviewBootstrapAssetCoverage,
  type LocalReviewBootstrapCandidate,
  type LocalReviewBootstrapDiff,
} from "@/domain/local-review-startup";
import { ASSET_IMPORT_LOCK_KEYS } from "@/domain/assets";
import { CATALOG_IMPORT_LOCK_KEYS } from "@/importers/dota-vpk/constants";
import { runMigrations } from "@/server/db/run-migrations";
import {
  openVerifiedDatabase,
  type VerifiedDatabase,
} from "@/server/environment/contract";
import {
  persistentDataStackIsProvisioned,
  provisionDataStack,
  startPersistentDataStack,
} from "@/server/environment/data-stack-lifecycle";

const STATE_DIRECTORY = ".medota2/environments/local-review";
const DATABASE_CONFIRMATION = "medota2_local";

interface CatalogHead {
  id: string;
}

interface BootstrapCandidateRow {
  id: string;
  gate_status: string;
  review_status: string;
  status: string;
}

interface BootstrapDiffRow {
  severity: string;
  diff_kind: string;
  entity_type: string;
}

interface AssetCoverageRow {
  expected_heroes: number;
  expected_abilities: number;
  bound_heroes: number;
  bound_abilities: number;
  missing_heroes: number;
  missing_abilities: number;
  incomplete_lods: number;
  generated_fallbacks: number;
  mismatches: number;
  errors: number;
}

async function main(): Promise<void> {
  configureEnvironment();
  await ensureStack();
  await migrateDatabase();

  const active = await loadActiveCatalog();
  if (active) {
    console.log(`[local-review] Catalog ${active.id} is ready.`);
    return;
  }

  console.log(
    "[local-review] No active Catalog exists; importing the configured VPK snapshot.",
  );
  await runWorker("src/workers/import-catalog.ts", [
    "--local-preview",
    "--download-missing",
  ]);

  const importedHead = await loadActiveCatalog();
  if (importedHead) {
    console.log(`[local-review] Catalog ${importedHead.id} is ready.`);
    return;
  }

  await recoverInitialAssetOnlyCandidate();
}

function configureEnvironment(): void {
  process.env.MEDOTA2_STATE_DIRECTORY = STATE_DIRECTORY;
  process.env.MEDOTA2_PROCESS_ROLE = "control";
  process.env.MEDOTA2_ENVIRONMENT = "local-review";
  process.env.MEDOTA2_DATA_CLASS = "production-snapshot";
  process.env.MEDOTA2_DATABASE_CONFIRMATION = DATABASE_CONFIRMATION;
}

async function ensureStack(): Promise<void> {
  if (persistentDataStackIsProvisioned()) {
    console.log("[local-review] Starting the existing PostgreSQL stack.");
    await startPersistentDataStack("local-review");
    return;
  }

  console.log(
    "[local-review] First run detected; provisioning an isolated PostgreSQL stack.",
  );
  await provisionDataStack({
    environment: "local-review",
    onProgress: (message) => console.log(`[local-review] ${message}`),
  });
}

async function migrateDatabase(): Promise<void> {
  const database = await openVerifiedDatabase({
    role: "migration",
    operation: "migrate",
    confirmation: DATABASE_CONFIRMATION,
  });
  try {
    const applied = await runMigrations(database);
    console.log(
      applied.length
        ? `[local-review] Applied ${applied.length} database migration(s).`
        : "[local-review] Database schema is current.",
    );
  } finally {
    await database.end();
  }
}

async function loadActiveCatalog(): Promise<CatalogHead | null> {
  return withReadDatabase(async (database) => {
    const result = await database.query<CatalogHead>(
      "SELECT catalog_dataset_version_id AS id FROM dataset_heads WHERE dataset_key = 'hero_catalog'",
    );
    return result.rows[0] ?? null;
  });
}

async function recoverInitialAssetOnlyCandidate(): Promise<void> {
  const { candidate, diffs } = await loadLatestCandidate();
  if (!candidate) {
    throw new Error(
      "The local-review import completed without an active Catalog or a reviewable candidate.",
    );
  }

  console.log(
    `[local-review] Candidate ${candidate.id} is pending Yellow review; retrying its assets.`,
  );
  await runWorker("src/workers/import-assets.ts", [
    "--catalog-version",
    candidate.id,
    "--download-missing",
  ]);

  const coverage = await loadAssetCoverage(candidate.id);
  const approval = evaluateLocalReviewBootstrapApproval(
    toCandidate(candidate),
    diffs.map(toDiff),
    coverage,
  );
  if (!approval.approved) {
    throw new Error(
      `Catalog ${candidate.id} still requires manual review: ${approval.reason}. ` +
        `Inspect it with pnpm data:diff:catalog:local --candidate ${candidate.id}.`,
    );
  }

  await approveCandidate(candidate.id);
  await promoteCandidate(candidate.id);
  console.log(
    `[local-review] Approved and promoted asset-only bootstrap candidate ${candidate.id}.`,
  );
}

async function loadLatestCandidate(): Promise<{
  candidate: BootstrapCandidateRow | null;
  diffs: BootstrapDiffRow[];
}> {
  return withReadDatabase(async (database) => {
    const result = await database.query<BootstrapCandidateRow>(
      `SELECT id, gate_status, review_status, status
       FROM hero_catalog_dataset_versions
       ORDER BY created_at DESC
       LIMIT 1`,
    );
    const candidate = result.rows[0] ?? null;
    if (!candidate) return { candidate: null, diffs: [] };
    const diffs = await database.query<BootstrapDiffRow>(
      `SELECT severity, diff_kind, entity_type
       FROM catalog_semantic_diffs
       WHERE candidate_version_id = $1
       ORDER BY id`,
      [candidate.id],
    );
    return { candidate, diffs: diffs.rows };
  });
}

async function loadAssetCoverage(
  catalogId: string,
): Promise<LocalReviewBootstrapAssetCoverage> {
  return withReadDatabase(async (database) => {
    const result = await database.query<AssetCoverageRow>(
      `SELECT
         (SELECT count(*)::int FROM heroes WHERE dataset_version_id = $1) AS expected_heroes,
         (SELECT count(*)::int FROM abilities WHERE dataset_version_id = $1) AS expected_abilities,
         count(*) FILTER (WHERE binding.entity_type = 'hero')::int AS bound_heroes,
         count(*) FILTER (WHERE binding.entity_type = 'ability')::int AS bound_abilities,
         (SELECT count(*)::int FROM heroes hero
          WHERE hero.dataset_version_id = $1 AND NOT EXISTS (
            SELECT 1 FROM entity_asset_bindings candidate
            WHERE candidate.asset_dataset_version_id = head.asset_dataset_version_id
              AND candidate.entity_type = 'hero'
              AND candidate.entity_key = hero.internal_name
              AND candidate.asset_kind = 'icon')) AS missing_heroes,
         (SELECT count(*)::int FROM abilities ability
          WHERE ability.dataset_version_id = $1 AND NOT EXISTS (
            SELECT 1 FROM entity_asset_bindings candidate
            WHERE candidate.asset_dataset_version_id = head.asset_dataset_version_id
              AND candidate.entity_type = 'ability'
              AND candidate.entity_key = ability.internal_name
              AND candidate.asset_kind = 'icon')) AS missing_abilities,
         count(*) FILTER (WHERE (
           SELECT count(DISTINCT variant.lod_key)
           FROM asset_variants variant
           WHERE variant.asset_object_id = binding.asset_object_id
             AND variant.lod_key = ANY('{original,w64,w128,w256}'::text[])
         ) <> 4)::int AS incomplete_lods,
         count(*) FILTER (WHERE binding.resolution_kind = 'generated_fallback')::int
           AS generated_fallbacks,
         count(*) FILTER (WHERE binding.source_status = 'mismatch')::int AS mismatches,
         count(*) FILTER (WHERE binding.source_status = 'error')::int AS errors
       FROM asset_dataset_heads head
       JOIN entity_asset_bindings binding
         ON binding.asset_dataset_version_id = head.asset_dataset_version_id
       WHERE head.catalog_dataset_version_id = $1
       GROUP BY head.asset_dataset_version_id`,
      [catalogId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`Catalog ${catalogId} has no promoted asset dataset.`);
    }
    return {
      expectedHeroes: row.expected_heroes,
      expectedAbilities: row.expected_abilities,
      boundHeroes: row.bound_heroes,
      boundAbilities: row.bound_abilities,
      missingHeroes: row.missing_heroes,
      missingAbilities: row.missing_abilities,
      incompleteLods: row.incomplete_lods,
      generatedFallbacks: row.generated_fallbacks,
      mismatches: row.mismatches,
      errors: row.errors,
    };
  });
}

async function approveCandidate(candidateId: string): Promise<void> {
  const database = await openVerifiedDatabase({
    role: "worker",
    operation: "review",
    confirmation: DATABASE_CONFIRMATION,
  });
  try {
    await database.query("SELECT review_hero_catalog_version($1, $2, $3)", [
      candidateId,
      "approved",
      "Automated local-review bootstrap: the only Yellow diff was a transient asset-provider error, and the retry produced complete native coverage with zero fallbacks, mismatches, or errors.",
    ]);
  } finally {
    await database.end();
  }
}

async function promoteCandidate(candidateId: string): Promise<void> {
  const database = await openVerifiedDatabase({
    role: "worker",
    operation: "promote",
    confirmation: DATABASE_CONFIRMATION,
  });
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ...CATALOG_IMPORT_LOCK_KEYS,
    ]);
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
      ...ASSET_IMPORT_LOCK_KEYS,
    ]);
    await client.query("SELECT promote_hero_catalog_version($1, false)", [
      candidateId,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await database.end();
  }
}

async function withReadDatabase<T>(
  callback: (database: VerifiedDatabase<"read">) => Promise<T>,
): Promise<T> {
  const database = await openVerifiedDatabase({
    role: "web",
    operation: "read",
  });
  try {
    return await callback(database);
  } finally {
    await database.end();
  }
}

function runWorker(script: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["exec", "tsx", script, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${script} failed${signal ? ` with signal ${signal}` : ` with exit code ${code ?? "unknown"}`}.`,
          ),
        );
      }
    });
  });
}

function toCandidate(
  row: BootstrapCandidateRow,
): LocalReviewBootstrapCandidate {
  return {
    gateStatus: row.gate_status,
    reviewStatus: row.review_status,
    status: row.status,
  };
}

function toDiff(row: BootstrapDiffRow): LocalReviewBootstrapDiff {
  return {
    severity: row.severity,
    diffKind: row.diff_kind,
    entityType: row.entity_type,
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
