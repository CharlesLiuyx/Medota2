import { createHash } from "node:crypto";
import { openVerifiedDatabase } from "@/server/environment/contract";

async function main(): Promise<void> {
  const database = await openVerifiedDatabase({
    role: "web",
    operation: "read",
  });
  try {
    const [server, migrations, catalogHeads, assetHeads, counts, schema] =
      await Promise.all([
        database.query<{ postgres_version: string }>(
          "SELECT current_setting('server_version') AS postgres_version",
        ),
        database.query<{ migration_id: string; file_sha256: string }>(
          "SELECT migration_id, file_sha256 FROM schema_migrations ORDER BY migration_id",
        ),
        database.query<{ dataset_key: string; version_id: string }>(
          "SELECT dataset_key, catalog_dataset_version_id::text AS version_id " +
            "FROM dataset_heads ORDER BY dataset_key",
        ),
        database.query<{
          catalog_version_id: string;
          asset_version_id: string;
        }>(
          "SELECT catalog_dataset_version_id::text AS catalog_version_id, " +
            "asset_dataset_version_id::text AS asset_version_id " +
            "FROM asset_dataset_heads ORDER BY catalog_dataset_version_id",
        ),
        database.query<{
          heroes: number;
          abilities: number;
          catalog_versions: number;
          asset_versions: number;
        }>(
          "SELECT " +
            "(SELECT count(*)::int FROM heroes) AS heroes, " +
            "(SELECT count(*)::int FROM abilities) AS abilities, " +
            "(SELECT count(*)::int FROM hero_catalog_dataset_versions) AS catalog_versions, " +
            "(SELECT count(*)::int FROM asset_dataset_versions) AS asset_versions",
        ),
        database.query<{ object_definition: string }>(
          `SELECT concat_ws('|', namespace.nspname, relation.relname, relation.relkind::text,
             pg_catalog.pg_get_userbyid(relation.relowner),
             COALESCE((SELECT string_agg(attribute.attname || ':' ||
               pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) || ':' ||
               attribute.attnotnull::text, ',' ORDER BY attribute.attnum)
               FROM pg_catalog.pg_attribute attribute
               WHERE attribute.attrelid = relation.oid AND attribute.attnum > 0
                 AND NOT attribute.attisdropped), ''),
             COALESCE((SELECT string_agg(constraint_record.contype::text || ':' ||
               pg_catalog.pg_get_constraintdef(constraint_record.oid, true), ','
               ORDER BY constraint_record.contype, constraint_record.conname)
               FROM pg_catalog.pg_constraint constraint_record
               WHERE constraint_record.conrelid = relation.oid), '')) AS object_definition
           FROM pg_catalog.pg_class relation
           JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
           WHERE namespace.nspname = 'public'
             AND relation.relkind IN ('r', 'p', 'v', 'm', 'S')
           ORDER BY relation.relname, relation.relkind`,
        ),
      ]);

    const schemaText = schema.rows
      .map((row) => row.object_definition)
      .join("\n");
    const identity = database.identity;
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        environment: identity.environment,
        dataClass: identity.dataClass,
        databaseName: identity.databaseName,
        databaseFingerprint: identity.safeFingerprint,
        runId: identity.runId,
        postgresVersion: server.rows[0].postgres_version,
        migrations: migrations.rows,
        catalogHeads: catalogHeads.rows,
        assetHeads: assetHeads.rows,
        counts: counts.rows[0],
        publicSchemaSha256: createHash("sha256")
          .update(schemaText)
          .digest("hex"),
      }),
    );
  } finally {
    await database.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
