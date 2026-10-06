import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { mapPackageSchema } from "@/domain/map/schema";
import { insideFile, sha256 } from "@/importers/dota-map/files";

export const mapCollectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    defaultVersion: z.string(),
    versions: z
      .array(
        z.object({
          id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/),
          patch: z.string().regex(/^\d+\.\d+[a-z]?$/),
          clientVersion: z.string().nullable(),
          path: z.string().min(1),
          revision: z.string().regex(/^[a-f0-9]{64}$/),
        }),
      )
      .min(1),
  })
  .superRefine((v, ctx) => {
    if (new Set(v.versions.map((p) => p.id)).size !== v.versions.length)
      ctx.addIssue({ code: "custom", message: "Duplicate map version ID" });
    if (!v.versions.some((p) => p.id === v.defaultVersion))
      ctx.addIssue({ code: "custom", message: "Default map version missing" });
  });
export async function readCollection(file: string) {
  return mapCollectionSchema.parse(JSON.parse(await readFile(file, "utf8")));
}
export async function loadMapPackage(
  collectionPath: string | undefined,
  legacyPath: string | undefined,
  id?: string,
) {
  let root: string;
  let selected:
    z.infer<typeof mapCollectionSchema>["versions"][number] | undefined;
  if (collectionPath) {
    const collection = await readCollection(collectionPath);
    selected = collection.versions.find(
      (v) => v.id === (id ?? collection.defaultVersion),
    );
    if (!selected) return null; // Never substitute another version for an explicit selection.
    const file = await insideFile(
      dirname(resolve(collectionPath)),
      `${selected.path}/map.json`,
    );
    root = dirname(file);
  } else {
    if (!legacyPath || id) return null;
    root = resolve(legacyPath);
  }
  const bytes = await readFile(resolve(root, "map.json"));
  const revision = sha256(bytes);
  const map = mapPackageSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (
    selected &&
    (selected.revision !== revision ||
      selected.patch !== map.provenance.public_source?.patch ||
      selected.clientVersion !== map.provenance.client_version)
  )
    throw new Error("Map collection identity/checksum mismatch");
  return { root, map, revision, id: selected?.id };
}
export async function loadMapAsset(
  collectionPath: string | undefined,
  legacyPath: string | undefined,
  id: string | undefined,
  name: string,
  revision: string | null,
) {
  const pkg = await loadMapPackage(collectionPath, legacyPath, id);
  if (!pkg || pkg.revision !== revision) return null;
  const asset =
    name === "overview.webp"
      ? pkg.map.image
      : pkg.map.rasterLayers.find((l) => l.file === name);
  if (!asset) return null;
  const bytes = await readFile(await insideFile(pkg.root, asset.file));
  if (sha256(bytes) !== asset.sha256)
    throw new Error("Map asset checksum mismatch");
  return { bytes, revision: pkg.revision, sha256: asset.sha256 };
}
