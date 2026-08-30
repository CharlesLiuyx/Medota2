import {
  discoverRemoteCommit,
  getCatalogSourceConfig,
} from "@/importers/catalog-source-lock";

async function main(): Promise<void> {
  const config = await getCatalogSourceConfig();
  const commit = await discoverRemoteCommit(config.remoteUrl);
  console.log(
    JSON.stringify(
      { source: "dota_vpk_updates", remoteUrl: config.remoteUrl, commit },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
