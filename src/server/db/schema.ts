import {
  bigint,
  boolean,
  check,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const sourceSnapshots = pgTable(
  "source_snapshots",
  {
    id: uuid().defaultRandom().primaryKey(),
    sourceRepository: text("source_repository").notNull(),
    sourceRemoteUrl: text("source_remote_url").notNull(),
    sourceCommit: text("source_commit").notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    sourceDirty: boolean("source_dirty").notNull(),
    sourceInputsMatchHead: boolean("source_inputs_match_head").notNull(),
    clientVersion: text("client_version").notNull(),
    sourceRevision: text("source_revision").notNull(),
    versionDate: text("version_date"),
    versionTime: text("version_time"),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique().on(
      table.sourceRepository,
      table.sourceCommit,
      table.manifestSha256,
    ),
  ],
);

export const importRuns = pgTable("import_runs", {
  id: uuid().defaultRandom().primaryKey(),
  sourceKind: text("source_kind").notNull(),
  status: text().notNull(),
  stage: text().notNull(),
  sourceSnapshotId: uuid("source_snapshot_id").references(
    () => sourceSnapshots.id,
  ),
  medota2Commit: text("medota2_commit").notNull(),
  transformerVersion: text("transformer_version").notNull(),
  targetSchemaVersion: text("target_schema_version").notNull(),
  sourceDirty: boolean("source_dirty"),
  sourceInputsMatchHead: boolean("source_inputs_match_head"),
  counts: jsonb().notNull(),
  issues: jsonb().notNull(),
  metrics: jsonb().notNull(),
  errorSummary: text("error_summary"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  resultDatasetVersionId: uuid("result_dataset_version_id"),
  resultReferenceSnapshotId: uuid("result_reference_snapshot_id"),
  resultComparisonId: uuid("result_comparison_id"),
});

export const heroDatasetVersions = pgTable(
  "hero_dataset_versions",
  {
    id: uuid().defaultRandom().primaryKey(),
    sourceSnapshotId: uuid("source_snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.id),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRuns.id),
    importerVersion: text("importer_version").notNull(),
    targetSchemaVersion: text("target_schema_version").notNull(),
    status: text().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true }),
  },
  (table) => [
    unique().on(table.importRunId),
    unique().on(
      table.sourceSnapshotId,
      table.importerVersion,
      table.targetSchemaVersion,
    ),
  ],
);

export const heroes = pgTable(
  "heroes",
  {
    datasetVersionId: uuid("dataset_version_id")
      .notNull()
      .references(() => heroDatasetVersions.id),
    heroId: integer("hero_id").notNull(),
    internalName: text("internal_name").notNull(),
    slug: text().notNull(),
    enabled: boolean().notNull(),
    cmEnabled: boolean("cm_enabled").notNull(),
    randomEnabled: boolean("random_enabled"),
    primaryAttribute: text("primary_attribute").notNull(),
    attackType: text("attack_type").notNull(),
    faction: text().notNull(),
    complexity: smallint().notNull(),
    baseStrength: numeric("base_strength", {
      precision: 12,
      scale: 6,
    }).notNull(),
    strengthGain: numeric("strength_gain", {
      precision: 12,
      scale: 6,
    }).notNull(),
    baseAgility: numeric("base_agility", { precision: 12, scale: 6 }).notNull(),
    agilityGain: numeric("agility_gain", { precision: 12, scale: 6 }).notNull(),
    baseIntelligence: numeric("base_intelligence", {
      precision: 12,
      scale: 6,
    }).notNull(),
    intelligenceGain: numeric("intelligence_gain", {
      precision: 12,
      scale: 6,
    }).notNull(),
    baseHealth: numeric("base_health", { precision: 12, scale: 6 }).notNull(),
    baseMana: numeric("base_mana", { precision: 12, scale: 6 }).notNull(),
    baseHealthRegen: numeric("base_health_regen", {
      precision: 12,
      scale: 6,
    }).notNull(),
    baseManaRegen: numeric("base_mana_regen", {
      precision: 12,
      scale: 6,
    }).notNull(),
    baseArmor: numeric("base_armor", { precision: 12, scale: 6 }).notNull(),
    magicResistance: numeric("magic_resistance", {
      precision: 12,
      scale: 6,
    }).notNull(),
    baseAttackDamageMin: numeric("base_attack_damage_min", {
      precision: 12,
      scale: 6,
    }).notNull(),
    baseAttackDamageMax: numeric("base_attack_damage_max", {
      precision: 12,
      scale: 6,
    }).notNull(),
    baseAttackSpeed: numeric("base_attack_speed", {
      precision: 12,
      scale: 6,
    }).notNull(),
    attackRate: numeric("attack_rate", { precision: 12, scale: 6 }).notNull(),
    attackAnimationPoint: numeric("attack_animation_point", {
      precision: 12,
      scale: 6,
    }).notNull(),
    attackRange: numeric("attack_range", { precision: 12, scale: 6 }).notNull(),
    projectileSpeed: numeric("projectile_speed", {
      precision: 12,
      scale: 6,
    }).notNull(),
    movementSpeed: numeric("movement_speed", {
      precision: 12,
      scale: 6,
    }).notNull(),
    turnRate: numeric("turn_rate", { precision: 12, scale: 6 }).notNull(),
    dayVision: numeric("day_vision", { precision: 12, scale: 6 }).notNull(),
    nightVision: numeric("night_vision", { precision: 12, scale: 6 }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.datasetVersionId, table.heroId] }),
    unique().on(table.datasetVersionId, table.internalName),
    unique().on(table.datasetVersionId, table.slug),
    check(
      "heroes_attack_damage_order",
      sql`${table.baseAttackDamageMax} >= ${table.baseAttackDamageMin}`,
    ),
  ],
);

export const heroRoles = pgTable(
  "hero_roles",
  {
    datasetVersionId: uuid("dataset_version_id").notNull(),
    heroId: integer("hero_id").notNull(),
    role: text().notNull(),
    roleLevel: smallint("role_level").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.datasetVersionId, table.heroId, table.role] }),
  ],
);

export const heroLocalizations = pgTable(
  "hero_localizations",
  {
    datasetVersionId: uuid("dataset_version_id").notNull(),
    heroId: integer("hero_id").notNull(),
    locale: text().notNull(),
    displayName: text("display_name").notNull(),
    englishNameVariant: text("english_name_variant"),
    hype: text(),
    lore: text(),
    nameSourcePath: text("name_source_path").notNull(),
    nameToken: text("name_token").notNull(),
    englishNameVariantToken: text("english_name_variant_token"),
    hypeSourcePath: text("hype_source_path"),
    hypeToken: text("hype_token"),
    loreSourcePath: text("lore_source_path"),
    loreToken: text("lore_token"),
  },
  (table) => [
    primaryKey({
      columns: [table.datasetVersionId, table.heroId, table.locale],
    }),
  ],
);

export const datasetHeads = pgTable("dataset_heads", {
  datasetKey: text("dataset_key").primaryKey(),
  heroDatasetVersionId: uuid("hero_dataset_version_id")
    .notNull()
    .references(() => heroDatasetVersions.id),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const referenceSnapshots = pgTable("reference_snapshots", {
  id: uuid().defaultRandom().primaryKey(),
  sourceRepository: text("source_repository").notNull(),
  sourceRemoteUrl: text("source_remote_url").notNull(),
  sourceCommit: text("source_commit").notNull(),
  sourceDirty: boolean("source_dirty").notNull(),
  sourceInputsMatchHead: boolean("source_inputs_match_head").notNull(),
  packageVersion: text("package_version").notNull(),
  heroesSha256: text("heroes_sha256").notNull(),
  packageSha256: text("package_sha256").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const heroReferenceComparisons = pgTable("hero_reference_comparisons", {
  id: uuid().defaultRandom().primaryKey(),
  datasetVersionId: uuid("dataset_version_id")
    .notNull()
    .references(() => heroDatasetVersions.id),
  referenceSnapshotId: uuid("reference_snapshot_id")
    .notNull()
    .references(() => referenceSnapshots.id),
  importRunId: uuid("import_run_id")
    .notNull()
    .references(() => importRuns.id),
  comparatorVersion: text("comparator_version").notNull(),
  canonicalCount: integer("canonical_count").notNull(),
  referenceCount: integer("reference_count").notNull(),
  matchedCount: integer("matched_count").notNull(),
  diffCount: integer("diff_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const heroReferenceDiffs = pgTable("hero_reference_diffs", {
  id: bigint({ mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  comparisonId: uuid("comparison_id")
    .notNull()
    .references(() => heroReferenceComparisons.id),
  heroId: integer("hero_id").notNull(),
  fieldName: text("field_name").notNull(),
  diffType: text("diff_type").notNull(),
  canonicalValue: jsonb("canonical_value"),
  referenceValue: jsonb("reference_value"),
});
