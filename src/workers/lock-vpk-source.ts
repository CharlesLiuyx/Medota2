import {
  createCatalogSourceLock,
  discoverRemoteCommit,
  getCatalogSourceConfig,
} from "@/importers/catalog-source-lock";

async function main(): Promise<void> {
  const commitIndex = process.argv.indexOf("--commit");
  const outputIndex = process.argv.indexOf("--out");
  const config = await getCatalogSourceConfig();
  const commit =
    commitIndex >= 0
      ? process.argv[commitIndex + 1]
      : await discoverRemoteCommit(config.remoteUrl);
  if (!commit) throw new Error("--commit requires a full SHA.");
  const result = await createCatalogSourceLock(
    commit,
    outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined,
  );
  console.log(
    JSON.stringify(
      {
        lockPath: result.path,
        sourceRepository: result.lock.sourceRepository,
        remoteUrl: result.lock.remoteUrl,
        commit: result.lock.commit,
        selectorVersion: result.lock.selectorVersion,
        selectorManifestSha256: result.lock.selectorManifestSha256,
        manifestSha256: result.lock.manifestSha256,
        clientVersion: result.lock.clientVersion,
        sourceRevision: result.lock.sourceRevision,
        fileCount: result.lock.files.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
