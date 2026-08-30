export const VPK_SOURCE_REPOSITORY = "spirit-bear-productions/dota_vpk_updates";

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

export const HERO_DENYLIST = new Set([
  "npc_dota_hero_base",
  "npc_dota_hero_target_dummy",
]);

export const HERO_IMPORT_LOCK_KEYS = [1296389185, 1751740001] as const;
