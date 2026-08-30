# Test fixture provenance

The VPK fixture is a manually cropped and deliberately modified KeyValues sample based on the field and localization layout reviewed at `spirit-bear-productions/dota_vpk_updates` commit `991daaf6fc24b08445209d9ce8767e145bab107e`. It contains no image, audio, model, or complete source file. `npc_dota_hero_test_cm_disabled` is synthetic. The dotaconstants fixture is a synthetic stale record shaped after `odota/dotaconstants` commit `e7705ee975ebec2a88a59a7b455d4cae5dc69ca1`; its health value is intentionally wrong to prove reference data never backfills canonical fields.

The fixture was cropped by retaining only the MVP allowlist keys for a base record, Anti-Mage, a synthetic `CMEnabled = 0` record, target dummy, and their minimum localization tokens. Error tests derive duplicate IDs, duplicate keys, missing names, explicit empty overrides, unknown enums, and role misalignment in memory.

Raw SHA-256 values:

```text
af256c5634094e2189f7a7c86f73a73f6fe8c84600760cdb58812b3dc2b7888f  vpk/resource/localization/abilities_english.txt
659ca5d1624edc56c945de06e5d7160902f4c290dccbce5589ad3b1782494c55  vpk/resource/localization/abilities_schinese.txt
c3046f449e7a232addeca9122ddb70139c9e3a67618b266c792fc728b7849ea2  vpk/resource/localization/dota_english.txt
da8bec869a0e4fe474fedeb4b0304161f238b379c9e53d7da909c661afb9f384  vpk/resource/localization/dota_schinese.txt
630cfa50abca2d89bb1946b4a1e30f3bcdedea0114e0b8abdd98d5486d12f14c  vpk/resource/localization/hero_lore_english.txt
b7443bf9706c6014bac484ce0b7b976cf734ef6480780843b5cc3246cc007cd8  vpk/resource/localization/hero_lore_schinese.txt
f887f41b70e6feb00aefdf1dc2d2fef25cf6b2156455172c68ba5a747686f669  vpk/scripts/npc/npc_heroes.txt
92d50325a931b7de214d250e9cd876bb50497478a9e04ee7b0ab20cdd57143c7  vpk/steam.inf
48acf101c8aa045792be777a58f763b5bf2fc13297970112abcc4018e60dabda  dotaconstants/heroes.json
```
