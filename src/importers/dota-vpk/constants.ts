export const VPK_SOURCE_REPOSITORY = "spirit-bear-productions/dota_vpk_updates";
export const CATALOG_SELECTOR_VERSION = "hero-catalog-selector-v1";
export const ABILITY_DERIVATION_VERSION = "hero-ability-relations-v1";

export const VPK_SOURCE_PATHS = [
  "scripts/npc/npc_heroes.txt",
  "resource/localization/abilities_english.txt",
  "resource/localization/abilities_schinese.txt",
  "resource/localization/dota_english.txt",
  "resource/localization/dota_schinese.txt",
  "resource/localization/hero_lore_english.txt",
  "resource/localization/hero_lore_schinese.txt",
  "steam.inf",
] as const;

export const CATALOG_STATIC_SOURCE_PATHS = [
  ...VPK_SOURCE_PATHS,
  "scripts/npc/npc_abilities.txt",
  "scripts/npc/npc_ability_ids.txt",
] as const;

export const HERO_ABILITY_SOURCE_PREFIX = "scripts/npc/heroes";
export const HERO_ABILITY_SOURCE_PATTERN =
  /^scripts\/npc\/heroes\/npc_dota_hero_[a-z0-9_]+\.txt$/u;

export const HERO_DENYLIST = new Set([
  "npc_dota_hero_base",
  "npc_dota_hero_target_dummy",
]);

export const HERO_IMPORT_LOCK_KEYS = [1296389185, 1751740001] as const;
export const CATALOG_IMPORT_LOCK_KEYS = HERO_IMPORT_LOCK_KEYS;

export const ABILITY_EXTERNAL_BASE_FALLBACKS = new Map([
  ["special_bonus_base", "ability_base"],
  ["brewmaster_void_astral_pull", "ability_base"],
]);
