import { getRequiredPath } from "@/config/env";
import { parseAbilityDataset } from "@/importers/dota-vpk/ability-adapter";
import {
  CATALOG_SELECTOR_VERSION,
  CATALOG_STATIC_SOURCE_PATHS,
  HERO_ABILITY_SOURCE_PATTERN,
  HERO_ABILITY_SOURCE_PREFIX,
} from "@/importers/dota-vpk/constants";
import { parseHeroDataset } from "@/importers/dota-vpk/hero-adapter";
import { parseSteamInf } from "@/importers/dota-vpk/steam";
import {
  discoverTrackedPaths,
  inspectGitCheckout,
} from "@/importers/git-checkout";
import { canonicalJsonSha256 } from "@/lib/hash";

async function main(): Promise<void> {
  const root = getRequiredPath("DOTA_VPK_UPDATES_PATH");
  const dynamicPaths = await discoverTrackedPaths(
    root,
    HERO_ABILITY_SOURCE_PREFIX,
    HERO_ABILITY_SOURCE_PATTERN,
  );
  const snapshot = await inspectGitCheckout(root, [
    ...CATALOG_STATIC_SOURCE_PATHS,
    ...dynamicPaths,
  ]);
  const steam = parseSteamInf(
    snapshot.files.find((file) => file.path === "steam.inf")!.text,
  );
  const heroes = parseHeroDataset(snapshot.files);
  const abilities = parseAbilityDataset(snapshot.files, heroes.heroes);
  const issueCodes = Object.fromEntries(
    [
      ...new Set(
        [...heroes.issues, ...abilities.issues].map((issue) => issue.code),
      ),
    ]
      .sort()
      .map((code) => [
        code,
        [...heroes.issues, ...abilities.issues].filter(
          (issue) => issue.code === code,
        ).length,
      ]),
  );

  console.log(
    JSON.stringify(
      {
        selectorVersion: CATALOG_SELECTOR_VERSION,
        selectorManifestSha256: canonicalJsonSha256(dynamicPaths),
        sourceRepository: snapshot.remoteUrl,
        sourceCommit: snapshot.commit,
        sourceManifestSha256: snapshot.manifestSha256,
        sourceDirty: snapshot.dirty,
        clientVersion: steam.clientVersion,
        sourceRevision: steam.sourceRevision,
        staticFiles: CATALOG_STATIC_SOURCE_PATHS.length,
        dynamicHeroAbilityFiles: dynamicPaths.length,
        heroes: heroes.counts,
        abilities: abilities.counts,
        issueCodes,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
