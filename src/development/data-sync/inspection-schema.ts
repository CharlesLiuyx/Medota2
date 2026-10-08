import current from "./schema.v1.json";
import { digest, type SnapshotManifest } from "./protocol";

// The reviewed 0010 schema differs only by the three tables added in 0011.
const previousSchemaDigest =
  "6b6b58fa96efb3d61c233c498ca8ccf088e958b6c71d1405f8278f9e68864ac2";
const previousMigrationsDigest =
  "70586843fee5bb9143316eba6627ea29c159ff7a502db16f49cf564636447167";
const itemTables = new Set([
  "item_asset_bindings",
  "item_asset_dataset_versions",
  "item_asset_heads",
]);

export function reviewedInspectionContract(
  manifest: Pick<SnapshotManifest, "schemaDigest" | "migrationsDigest">,
  migrations: { id: string; sha256: string }[],
) {
  if (
    manifest.schemaDigest === digest(current) &&
    manifest.migrationsDigest === digest(migrations)
  )
    return undefined;
  if (
    manifest.schemaDigest !== previousSchemaDigest ||
    manifest.migrationsDigest !== previousMigrationsDigest
  )
    throw new Error(
      "Active snapshot has no supported read-only schema contract. Use its matching code to preserve local data.",
    );
  const schema = {
    columns: current.columns.filter(
      (table) => !itemTables.has(table.table_name),
    ),
    constraints: current.constraints.filter(
      (constraint) => !itemTables.has(constraint.table_name),
    ),
    keys: current.keys.filter((key) => !itemTables.has(key.table_name)),
  };
  const previousMigrations = migrations.filter(
    (migration) => migration.id !== "0011_item_asset_datasets.sql",
  );
  if (
    digest(schema) !== previousSchemaDigest ||
    digest(previousMigrations) !== previousMigrationsDigest
  )
    throw new Error(
      "Historical inspection contract no longer matches its reviewed digests.",
    );
  return { schema, migrations: previousMigrations };
}
