import { resolve } from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { syncRoot } from "@/config/data-sync-state";
import { readSnapshot, verifySnapshotFiles, manifestPath } from "./snapshot";
import { putFile, blobPath, chunkPath } from "./files";

/** Prepare an exact, reviewable Git payload. This never stages, commits or pushes. */
export async function bundleSnapshot(
  root: string,
  id: string,
  destination = resolve(syncRoot(), "bundles", id),
) {
  const saved = await readSnapshot(root, id);
  const verification = await verifySnapshotFiles(root, saved.manifest);
  await mkdir(destination, { recursive: true });
  await putFile(
    manifestPath(destination, id),
    await readFile(manifestPath(root, id)),
  );
  for (const table of saved.manifest.tables)
    for (const chunk of table.chunks)
      await putFile(
        chunkPath(destination, chunk.sha256),
        await readFile(chunkPath(root, chunk.sha256)),
      );
  for (const object of saved.manifest.objects)
    await putFile(
      blobPath(destination, object.sha256),
      await readFile(blobPath(root, object.sha256)),
    );
  await writePublicationMetadata(destination);
  await verifySnapshotFiles(destination, saved.manifest);
  return {
    destination,
    snapshotId: id,
    manifestSha256: saved.manifestSha256,
    ...verification,
  };
}

export async function writePublicationMetadata(destination: string) {
  await putFile(
    resolve(destination, ".gitattributes"),
    "objects/* filter=lfs diff=lfs merge=lfs -text\ntables/* -text\nsnapshots/** -text\n",
  );
  await putFile(
    resolve(destination, "README.md"),
    "# Medota2 development data\n\nPrivate development snapshots. Access is separate from the public code repository.\n\nImmutable manifests select NDJSON tables and SHA-256 addressed Git LFS objects. Database roles, credentials, machine identities and control schemas are excluded.\n\nGame assets remain the property of their respective owners; private storage does not grant redistribution rights. Preserve source provenance and included attribution. No public redistribution is authorized by this repository.\n\nRetain all data commits and LFS objects referenced by supported code versions. Never force-push or prune referenced snapshots.\n",
  );
}
