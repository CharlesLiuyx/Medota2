import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
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
import type {
  AbilityIdMapping,
  CanonicalAbility,
  CanonicalFacet,
  HeroAbilityBinding,
} from "@/domain/abilities";
import type { CanonicalHero } from "@/domain/heroes";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

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

export const sourceSnapshotFiles = pgTable(
  "source_snapshot_files",
  {
    sourceSnapshotId: uuid("source_snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.id),
    sourcePath: text("source_path").notNull(),
    rawSha256: text("raw_sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    encoding: text().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceSnapshotId, table.sourcePath] }),
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
  resultCatalogVersionId: uuid("result_catalog_version_id"),
  resultReferenceSnapshotId: uuid("result_reference_snapshot_id"),
  resultComparisonId: uuid("result_comparison_id"),
});

export const heroCatalogDatasetVersions = pgTable(
  "hero_catalog_dataset_versions",
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
    selectorVersion: text("selector_version").notNull(),
    selectorManifestSha256: text("selector_manifest_sha256").notNull(),
    semanticSha256: text("semantic_sha256").notNull(),
    gateStatus: text("gate_status").notNull(),
    reviewStatus: text("review_status").notNull(),
    gateSummary: jsonb("gate_summary").notNull(),
    sourceCounts: jsonb("source_counts").notNull(),
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
      table.selectorVersion,
    ),
  ],
);

export const heroes = pgTable(
  "heroes",
  {
    datasetVersionId: uuid("dataset_version_id")
      .notNull()
      .references(() => heroCatalogDatasetVersions.id),
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

export const heroSourceRecords = pgTable(
  "hero_source_records",
  {
    datasetVersionId: uuid("dataset_version_id").notNull(),
    heroId: integer("hero_id").notNull(),
    sourceKey: text("source_key").notNull(),
    sourceDtoSha256: text("source_dto_sha256").notNull(),
    inheritedFields: text("inherited_fields").array().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.datasetVersionId, table.heroId] }),
    foreignKey({
      columns: [table.datasetVersionId, table.heroId],
      foreignColumns: [heroes.datasetVersionId, heroes.heroId],
    }),
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
    foreignKey({
      columns: [table.datasetVersionId, table.heroId],
      foreignColumns: [heroes.datasetVersionId, heroes.heroId],
    }),
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
    foreignKey({
      columns: [table.datasetVersionId, table.heroId],
      foreignColumns: [heroes.datasetVersionId, heroes.heroId],
    }),
  ],
);

export const datasetHeads = pgTable("dataset_heads", {
  datasetKey: text("dataset_key").primaryKey(),
  catalogDatasetVersionId: uuid("catalog_dataset_version_id")
    .notNull()
    .references(() => heroCatalogDatasetVersions.id),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const abilities = pgTable(
  "abilities",
  {
    datasetVersionId: uuid("dataset_version_id")
      .notNull()
      .references(() => heroCatalogDatasetVersions.id),
    internalName: text("internal_name").notNull(),
    declarationKind: text("declaration_kind").notNull(),
    definitionKind: text("definition_kind").notNull(),
    catalogStatus: text("catalog_status").notNull(),
    abilityType: text("ability_type"),
    behavior: text().array().notNull(),
    unitTargetTeam: text("unit_target_team").array().notNull(),
    unitTargetType: text("unit_target_type").array().notNull(),
    unitTargetFlags: text("unit_target_flags").array().notNull(),
    damageType: text("damage_type"),
    spellImmunityType: text("spell_immunity_type"),
    spellDispellableType: text("spell_dispellable_type"),
    maxLevel: integer("max_level"),
    isInnate: boolean("is_innate").notNull(),
    isPassive: boolean("is_passive").notNull(),
    isHidden: boolean("is_hidden").notNull(),
    isUltimate: boolean("is_ultimate").notNull(),
    hasScepterUpgrade: boolean("has_scepter_upgrade").notNull(),
    hasShardUpgrade: boolean("has_shard_upgrade").notNull(),
    isGrantedByScepter: boolean("is_granted_by_scepter").notNull(),
    isGrantedByShard: boolean("is_granted_by_shard").notNull(),
    castRange: text("cast_range"),
    castPoint: text("cast_point"),
    channelTime: text("channel_time"),
    cooldown: text(),
    manaCost: text("mana_cost"),
    damage: text(),
    textureName: text("texture_name").notNull(),
    baseClass: text("base_class"),
    rawSha256: text("raw_sha256").notNull(),
    resolvedSha256: text("resolved_sha256").notNull(),
    unknownFields: text("unknown_fields").array().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.datasetVersionId, table.internalName] }),
  ],
);

export const abilityIdMappings = pgTable("ability_id_mappings", {
  id: bigint({ mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  datasetVersionId: uuid("dataset_version_id")
    .notNull()
    .references(() => heroCatalogDatasetVersions.id),
  internalName: text("internal_name").notNull(),
  abilityId: integer("ability_id").notNull(),
  sourcePath: text("source_path").notNull(),
  sourceLine: integer("source_line").notNull(),
});

export const heroAbilityBindings = pgTable(
  "hero_ability_bindings",
  {
    datasetVersionId: uuid("dataset_version_id").notNull(),
    heroId: integer("hero_id").notNull(),
    abilityInternalName: text("ability_internal_name").notNull(),
    sourceSlot: text("source_slot").notNull(),
    relationKind: text("relation_kind").notNull(),
    ordinal: integer().notNull(),
    isCurrent: boolean("is_current").notNull(),
    sourcePath: text("source_path").notNull(),
    sourceLine: integer("source_line").notNull(),
    derivationVersion: text("derivation_version").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.datasetVersionId,
        table.heroId,
        table.abilityInternalName,
        table.relationKind,
        table.sourceSlot,
      ],
    }),
    foreignKey({
      columns: [table.datasetVersionId, table.heroId],
      foreignColumns: [heroes.datasetVersionId, heroes.heroId],
    }),
    foreignKey({
      columns: [table.datasetVersionId, table.abilityInternalName],
      foreignColumns: [abilities.datasetVersionId, abilities.internalName],
    }),
  ],
);

export const abilityValues = pgTable(
  "ability_values",
  {
    datasetVersionId: uuid("dataset_version_id").notNull(),
    abilityInternalName: text("ability_internal_name").notNull(),
    valueKey: text("value_key").notNull(),
    ordinal: integer().notNull(),
    scalarValue: text("scalar_value"),
    levelValues: text("level_values").array().notNull(),
    modifiers: jsonb().notNull(),
    rawValue: jsonb("raw_value").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.datasetVersionId,
        table.abilityInternalName,
        table.ordinal,
      ],
    }),
    foreignKey({
      columns: [table.datasetVersionId, table.abilityInternalName],
      foreignColumns: [abilities.datasetVersionId, abilities.internalName],
    }),
  ],
);

export const abilityLocalizations = pgTable(
  "ability_localizations",
  {
    datasetVersionId: uuid("dataset_version_id").notNull(),
    abilityInternalName: text("ability_internal_name").notNull(),
    locale: text().notNull(),
    displayName: text("display_name"),
    description: text(),
    lore: text(),
    scepterDescription: text("scepter_description"),
    shardDescription: text("shard_description"),
    sourcePath: text("source_path").notNull(),
    nameToken: text("name_token").notNull(),
    descriptionToken: text("description_token").notNull(),
    loreToken: text("lore_token").notNull(),
    scepterToken: text("scepter_token").notNull(),
    shardToken: text("shard_token").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.datasetVersionId,
        table.abilityInternalName,
        table.locale,
      ],
    }),
    foreignKey({
      columns: [table.datasetVersionId, table.abilityInternalName],
      foreignColumns: [abilities.datasetVersionId, abilities.internalName],
    }),
  ],
);

export const facets = pgTable(
  "facets",
  {
    datasetVersionId: uuid("dataset_version_id").notNull(),
    heroId: integer("hero_id").notNull(),
    facetKey: text("facet_key").notNull(),
    icon: text(),
    color: text(),
    gradientId: integer("gradient_id"),
    deprecated: boolean().notNull(),
    sourcePath: text("source_path").notNull(),
    sourceLine: integer("source_line").notNull(),
    rawDefinition: jsonb("raw_definition").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.datasetVersionId, table.heroId, table.facetKey],
    }),
    foreignKey({
      columns: [table.datasetVersionId, table.heroId],
      foreignColumns: [heroes.datasetVersionId, heroes.heroId],
    }),
  ],
);

export const facetAbilityBindings = pgTable(
  "facet_ability_bindings",
  {
    datasetVersionId: uuid("dataset_version_id").notNull(),
    heroId: integer("hero_id").notNull(),
    facetKey: text("facet_key").notNull(),
    abilityInternalName: text("ability_internal_name").notNull(),
    sourcePath: text("source_path").notNull(),
    sourceLine: integer("source_line").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.datasetVersionId,
        table.heroId,
        table.facetKey,
        table.abilityInternalName,
      ],
    }),
    foreignKey({
      columns: [table.datasetVersionId, table.heroId, table.facetKey],
      foreignColumns: [facets.datasetVersionId, facets.heroId, facets.facetKey],
    }),
    foreignKey({
      columns: [table.datasetVersionId, table.abilityInternalName],
      foreignColumns: [abilities.datasetVersionId, abilities.internalName],
    }),
  ],
);

export const entitySourceRecords = pgTable(
  "entity_source_records",
  {
    datasetVersionId: uuid("dataset_version_id")
      .notNull()
      .references(() => heroCatalogDatasetVersions.id),
    entityType: text("entity_type").notNull(),
    entityKey: text("entity_key").notNull(),
    occurrenceOrdinal: integer("occurrence_ordinal").notNull(),
    sourcePath: text("source_path").notNull(),
    sourceLine: integer("source_line"),
    sourceKey: text("source_key").notNull(),
    declarationKind: text("declaration_kind"),
    rawDefinition: jsonb("raw_definition").notNull(),
    resolvedDefinition: jsonb("resolved_definition"),
    rawSha256: text("raw_sha256").notNull(),
    resolvedSha256: text("resolved_sha256"),
    inheritedFields: text("inherited_fields").array().notNull(),
    unknownFields: text("unknown_fields").array().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.datasetVersionId,
        table.entityType,
        table.entityKey,
        table.occurrenceOrdinal,
      ],
    }),
  ],
);

export const assetRefs = pgTable(
  "asset_refs",
  {
    datasetVersionId: uuid("dataset_version_id")
      .notNull()
      .references(() => heroCatalogDatasetVersions.id),
    entityType: text("entity_type").notNull(),
    entityKey: text("entity_key").notNull(),
    assetKind: text("asset_kind").notNull(),
    logicalPath: text("logical_path").notNull(),
    clientVersion: text("client_version"),
    contentSha256: text("content_sha256"),
    mimeType: text("mime_type"),
    width: integer(),
    height: integer(),
    cacheStatus: text("cache_status").notNull(),
    providerVersion: text("provider_version").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.datasetVersionId,
        table.entityType,
        table.entityKey,
        table.assetKind,
      ],
    }),
  ],
);

export const assetBlobs = pgTable(
  "asset_blobs",
  {
    contentSha256: text("content_sha256").primaryKey(),
    mimeType: text("mime_type").notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    content: bytea().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "asset_blobs_content_sha256_check",
      sql`${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("asset_blobs_mime_type_check", sql`${table.mimeType} <> ''`),
    check("asset_blobs_width_check", sql`${table.width} > 0`),
    check("asset_blobs_height_check", sql`${table.height} > 0`),
    check("asset_blobs_byte_size_check", sql`${table.byteSize} > 0`),
    check(
      "asset_blobs_byte_size_matches_content",
      sql`${table.byteSize} = octet_length(${table.content})`,
    ),
    check(
      "asset_blobs_content_sha256_matches_content",
      sql`encode(public.digest(${table.content}, 'sha256'), 'hex') = ${table.contentSha256}`,
    ),
  ],
);

export const assetObjects = pgTable(
  "asset_objects",
  {
    id: uuid().defaultRandom().primaryKey(),
    objectSha256: text("object_sha256").notNull().unique(),
    assetKind: text("asset_kind").notNull(),
    logicalPath: text("logical_path").notNull(),
    sourceType: text("source_type").notNull(),
    sourceRepository: text("source_repository"),
    sourceCommit: text("source_commit"),
    clientVersion: text("client_version"),
    sourceContentSha256: text("source_content_sha256"),
    originalBlobSha256: text("original_blob_sha256")
      .notNull()
      .references(() => assetBlobs.contentSha256),
    providerVersion: text("provider_version").notNull(),
    metadata: jsonb().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "asset_objects_object_sha256_check",
      sql`${table.objectSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check("asset_objects_asset_kind_check", sql`${table.assetKind} = 'icon'`),
    check("asset_objects_logical_path_check", sql`${table.logicalPath} <> ''`),
    check(
      "asset_objects_source_type_check",
      sql`${table.sourceType} IN ('exact', 'alias', 'generated_fallback')`,
    ),
    check(
      "asset_objects_source_commit_check",
      sql`${table.sourceCommit} IS NULL OR ${table.sourceCommit} ~ '^[0-9a-f]{40}$'`,
    ),
    check(
      "asset_objects_source_content_sha256_check",
      sql`${table.sourceContentSha256} IS NULL OR ${table.sourceContentSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "asset_objects_provider_version_check",
      sql`${table.providerVersion} <> ''`,
    ),
    check(
      "asset_objects_metadata_check",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
  ],
);

export const assetVariants = pgTable(
  "asset_variants",
  {
    assetObjectId: uuid("asset_object_id")
      .notNull()
      .references(() => assetObjects.id),
    lodKey: text("lod_key").notNull(),
    targetWidth: integer("target_width"),
    blobSha256: text("blob_sha256")
      .notNull()
      .references(() => assetBlobs.contentSha256),
    transformerVersion: text("transformer_version").notNull(),
    quality: integer(),
  },
  (table) => [
    primaryKey({ columns: [table.assetObjectId, table.lodKey] }),
    check(
      "asset_variants_lod_key_check",
      sql`${table.lodKey} IN ('original', 'w64', 'w128', 'w256')`,
    ),
    check(
      "asset_variants_lod_target_width_check",
      sql`(${table.lodKey} = 'original' AND ${table.targetWidth} IS NULL)
        OR (${table.lodKey} = 'w64' AND ${table.targetWidth} = 64)
        OR (${table.lodKey} = 'w128' AND ${table.targetWidth} = 128)
        OR (${table.lodKey} = 'w256' AND ${table.targetWidth} = 256)`,
    ),
    check(
      "asset_variants_transformer_version_check",
      sql`${table.transformerVersion} <> ''`,
    ),
    check(
      "asset_variants_quality_check",
      sql`${table.quality} IS NULL OR ${table.quality} BETWEEN 1 AND 100`,
    ),
  ],
);

export const assetDatasetVersions = pgTable(
  "asset_dataset_versions",
  {
    id: uuid().defaultRandom().primaryKey(),
    catalogDatasetVersionId: uuid("catalog_dataset_version_id")
      .notNull()
      .references(() => heroCatalogDatasetVersions.id),
    manifestSha256: text("manifest_sha256").notNull(),
    clientVersion: text("client_version"),
    providerVersion: text("provider_version").notNull(),
    lodPolicyVersion: text("lod_policy_version").notNull(),
    sourceCounts: jsonb("source_counts").notNull().default({}),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "asset_dataset_versions_manifest_sha256_check",
      sql`${table.manifestSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "asset_dataset_versions_provider_version_check",
      sql`${table.providerVersion} <> ''`,
    ),
    check(
      "asset_dataset_versions_lod_policy_version_check",
      sql`${table.lodPolicyVersion} <> ''`,
    ),
    check(
      "asset_dataset_versions_source_counts_check",
      sql`jsonb_typeof(${table.sourceCounts}) = 'object'`,
    ),
    unique("asset_dataset_versions_identity").on(
      table.catalogDatasetVersionId,
      table.manifestSha256,
      table.providerVersion,
      table.lodPolicyVersion,
    ),
    unique("asset_dataset_versions_catalog_pair").on(
      table.catalogDatasetVersionId,
      table.id,
    ),
  ],
);

export const entityAssetBindings = pgTable(
  "entity_asset_bindings",
  {
    assetDatasetVersionId: uuid("asset_dataset_version_id")
      .notNull()
      .references(() => assetDatasetVersions.id),
    entityType: text("entity_type").notNull(),
    entityKey: text("entity_key").notNull(),
    assetKind: text("asset_kind").notNull(),
    assetObjectId: uuid("asset_object_id")
      .notNull()
      .references(() => assetObjects.id),
    resolutionKind: text("resolution_kind").notNull(),
    sourceStatus: text("source_status").notNull(),
    requestedLogicalPath: text("requested_logical_path").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.assetDatasetVersionId,
        table.entityType,
        table.entityKey,
        table.assetKind,
      ],
    }),
    check(
      "entity_asset_bindings_entity_type_check",
      sql`${table.entityType} IN ('hero', 'ability')`,
    ),
    check(
      "entity_asset_bindings_entity_key_check",
      sql`${table.entityKey} <> ''`,
    ),
    check(
      "entity_asset_bindings_asset_kind_check",
      sql`${table.assetKind} = 'icon'`,
    ),
    check(
      "entity_asset_bindings_resolution_kind_check",
      sql`${table.resolutionKind} IN ('exact', 'alias', 'generated_fallback')`,
    ),
    check(
      "entity_asset_bindings_source_status_check",
      sql`${table.sourceStatus} IN ('available', 'fallback', 'mismatch', 'error')`,
    ),
    check(
      "entity_asset_bindings_requested_logical_path_check",
      sql`${table.requestedLogicalPath} <> ''`,
    ),
  ],
);

export const assetDatasetHeads = pgTable(
  "asset_dataset_heads",
  {
    catalogDatasetVersionId: uuid("catalog_dataset_version_id")
      .primaryKey()
      .references(() => heroCatalogDatasetVersions.id),
    assetDatasetVersionId: uuid("asset_dataset_version_id").notNull().unique(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.catalogDatasetVersionId, table.assetDatasetVersionId],
      foreignColumns: [
        assetDatasetVersions.catalogDatasetVersionId,
        assetDatasetVersions.id,
      ],
      name: "asset_dataset_heads_matching_catalog_fk",
    }),
  ],
);

type CatalogStagingPayload =
  | CanonicalHero
  | CanonicalAbility
  | AbilityIdMapping
  | HeroAbilityBinding
  | CanonicalFacet;

export const catalogImportStaging = pgTable(
  "catalog_import_staging",
  {
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRuns.id),
    entityType: text("entity_type").notNull(),
    entityKey: text("entity_key").notNull(),
    ordinal: integer().notNull(),
    payload: jsonb().$type<CatalogStagingPayload>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.importRunId,
        table.entityType,
        table.entityKey,
        table.ordinal,
      ],
    }),
  ],
);

export const catalogSemanticDiffs = pgTable("catalog_semantic_diffs", {
  id: bigint({ mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  candidateVersionId: uuid("candidate_version_id")
    .notNull()
    .references(() => heroCatalogDatasetVersions.id),
  severity: text().notNull(),
  diffKind: text("diff_kind").notNull(),
  entityType: text("entity_type").notNull(),
  entityKey: text("entity_key").notNull(),
  fieldName: text("field_name"),
  beforeValue: jsonb("before_value"),
  afterValue: jsonb("after_value"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const catalogReviews = pgTable("catalog_reviews", {
  id: bigint({ mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  candidateVersionId: uuid("candidate_version_id")
    .notNull()
    .references(() => heroCatalogDatasetVersions.id),
  decision: text().notNull(),
  reviewer: text().notNull(),
  reason: text().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const catalogRollbacks = pgTable("catalog_rollbacks", {
  id: bigint({ mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  fromVersionId: uuid("from_version_id")
    .notNull()
    .references(() => heroCatalogDatasetVersions.id),
  toVersionId: uuid("to_version_id")
    .notNull()
    .references(() => heroCatalogDatasetVersions.id),
  actor: text().notNull(),
  reason: text().notNull(),
  rolledBackAt: timestamp("rolled_back_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const heroImportStaging = pgTable(
  "hero_import_staging",
  {
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRuns.id),
    heroId: integer("hero_id").notNull(),
    payload: jsonb().$type<CanonicalHero>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.importRunId, table.heroId] })],
);

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

export const referenceHeroRecords = pgTable(
  "reference_hero_records",
  {
    referenceSnapshotId: uuid("reference_snapshot_id")
      .notNull()
      .references(() => referenceSnapshots.id),
    heroId: integer("hero_id").notNull(),
    internalName: text("internal_name").notNull(),
    rawRecord: jsonb("raw_record").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.referenceSnapshotId, table.heroId] }),
  ],
);

export const heroReferenceComparisons = pgTable("hero_reference_comparisons", {
  id: uuid().defaultRandom().primaryKey(),
  datasetVersionId: uuid("dataset_version_id")
    .notNull()
    .references(() => heroCatalogDatasetVersions.id),
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

export const schemaMigrations = pgTable("schema_migrations", {
  migrationId: text("migration_id").primaryKey(),
  fileSha256: text("file_sha256").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
