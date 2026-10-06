import { link, readFile, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, relative, resolve, sep } from "node:path";
import { mapCollectionSchema, loadMapPackage } from "@/server/map/packages";
import { argument, sha256 } from "@/importers/dota-map/files";
import { mapPackageSchema } from "@/domain/map/schema";

async function main() {
  const args = process.argv.slice(2),
    output = resolve(argument(args, "output"));
  const entries = args.flatMap((v, i) =>
    v === "--dataset" ? [args[i + 1]] : [],
  );
  const versions = await Promise.all(
    entries.map(async (entry) => {
      if (!entry || entry.startsWith("--"))
        throw new Error("Use --dataset id=directory");
      const split = entry.indexOf("=");
      if (split < 1) throw new Error("Use --dataset id=directory");
      const id = entry.slice(0, split),
        root = resolve(entry.slice(split + 1));
      const bytes = await readFile(resolve(root, "map.json"));
      const map = mapPackageSchema.parse(JSON.parse(bytes.toString("utf8")));
      return {
        id,
        path: relative(dirname(output), root).split(sep).join("/"),
        patch: map.provenance.public_source?.patch,
        clientVersion: map.provenance.client_version,
        revision: sha256(bytes),
      };
    }),
  );
  const collection = mapCollectionSchema.parse({
    schemaVersion: 1,
    defaultVersion: argument(args, "default"),
    versions,
  });
  if (collection.versions.some((v) => v.path.split("/").includes("..")))
    throw new Error("Datasets must be inside the collection directory");
  const staging = resolve(dirname(output), `.map-index-${randomUUID()}.json`);
  await writeFile(staging, JSON.stringify(collection, null, 2) + "\n", {
    flag: "wx",
  });
  try {
    for (const entry of collection.versions)
      await loadMapPackage(staging, undefined, entry.id);
    // Same-directory hard link publishes the verified bytes without replacing an existing registry.
    await link(staging, output);
  } finally {
    await unlink(staging);
  }
  console.log(`Indexed ${versions.length} independent map datasets: ${output}`);
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
