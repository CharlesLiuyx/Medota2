import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { insideFile } from "@/importers/dota-map/files";
import { sha256, canonicalJsonSha256 } from "@/lib/hash";
import { MAP_ICON_PROVIDER, type MapIcon } from "@/domain/map/icons";
import type { PreparedEntityAsset } from "@/domain/assets";
import { buildVariants } from "./catalog-assets";

const bundleManifestSha =
  "845e0b3d124023796a508f215ddb3b1b8753c3ccd470af76d00a4781dc417528";
export const MAP_ICON_SOURCE_COMMIT =
  "f4c45719314754567cb4ef4fe343bbc790a311f4";
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const fileSchema = z.object({
  path: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: hash,
});
const manifestSchema = z.object({
  schemaVersion: z.literal(3),
  bundleVersion: z.literal("map-assets/3"),
  nativeClientVersion: z.literal("6944"),
  files: z.array(fileSchema),
});
type IconInput = {
  key: string;
  path: string;
  label: string;
  group: MapIcon["group"];
  evidence: Record<string, unknown>;
  sourceRepository?: string;
  sourceCommit?: string;
  sourcePath?: string;
  sourceUrl?: string;
};

/** Only the reviewed v3 bundle is accepted. Every evidence file is verified before writes. */
export async function prepareMapPackageAssets(root: string) {
  const manifestBytes = await readFile(await insideFile(root, "manifest.json"));
  if (sha256(manifestBytes) !== bundleManifestSha)
    throw new Error("Unreviewed map asset manifest.");
  const manifest = manifestSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  const files = new Map<string, Buffer>();
  for (const file of manifest.files) {
    if (files.has(file.path))
      throw new Error(`Duplicate package path: ${file.path}`);
    const bytes = await readFile(await insideFile(root, file.path));
    if (bytes.length !== file.sizeBytes || sha256(bytes) !== file.sha256)
      throw new Error(`Package checksum mismatch: ${file.path}`);
    files.set(file.path, bytes);
  }
  const json = <T>(path: string): T =>
    JSON.parse(files.get(path)!.toString("utf8"));
  const icons = json<
    Array<{
      key: string;
      path: string;
      sha256: string;
      material: string;
      rect: { width: number; height: number };
      [key: string]: unknown;
    }>
  >("icons.json");
  const curated =
    json<
      Array<{ iconKey: string; path: string; sha256: string; label: string }>
    >("map-assets.json");
  // Curated paths are aliases of corrected atlas entries, not extra game objects.
  for (const alias of curated) {
    const icon = icons.find((i) => i.key === alias.iconKey);
    if (
      !icon ||
      icon.sha256 !== alias.sha256 ||
      sha256(files.get(alias.path)!) !== icon.sha256
    )
      throw new Error(`Invalid map alias: ${alias.path}`);
  }
  const inputs: IconInput[] = icons.map((icon) => ({
    key: icon.key,
    path: icon.path,
    label:
      curated.find((a) => a.iconKey === icon.key)?.label ??
      icon.key.replace(/^minimap_(heroicon_)?/u, ""),
    group: icon.material.includes("hero_sheet") ? "hero" : "map",
    evidence: icon,
  }));
  for (const entry of json<
    Array<{ path: string; materialPath: string; texturePath: string }>
  >("standalone-assets.json")) {
    const name = basename(entry.path, ".png");
    inputs.push({
      key: `material_${name}`,
      path: entry.path,
      label: name,
      group: "material",
      evidence: entry,
      sourcePath: entry.texturePath,
    });
  }
  for (const path of files.keys()) {
    if (path.startsWith("decoded/panorama/") && /\.(png|svg)$/u.test(path)) {
      const name = basename(path).replace(/\.(png|svg)$/u, "");
      inputs.push({
        key: `hud_${name}`,
        path,
        label: name,
        group: "hud",
        evidence: { usage: "HUD artwork; not a dedicated minimap icon" },
      });
    }
  }
  for (const entry of json<
    Array<{
      path: string;
      source_repository: string;
      source_commit: string;
      source_path: string;
      source_url: string;
    }>
  >("supplements/devilesk/assets.json")) {
    const name = basename(entry.path, ".png");
    inputs.push({
      key: `devilesk_${name}`,
      path: entry.path,
      label: name === "ward_observer" ? "侦查守卫 · 彩色" : "岗哨守卫 · 彩色",
      group: "supplement",
      evidence: {
        ...entry,
        license: files.get("supplements/devilesk/LICENSE")!.toString("utf8"),
      },
      sourceRepository: entry.source_repository,
      sourceCommit: entry.source_commit,
      sourcePath: entry.source_path,
      sourceUrl: entry.source_url,
    });
  }
  if (new Set(inputs.map((i) => i.key)).size !== inputs.length)
    throw new Error("Duplicate map icon identity.");
  const assets: PreparedEntityAsset[] = [];
  const entries = [];
  for (const input of inputs) {
    const original = files.get(input.path);
    if (!original) throw new Error(`Unlisted asset: ${input.path}`);
    // SVG is rasterized at its original dimensions; HTTP only serves image bytes.
    const bytes = input.path.endsWith(".svg")
      ? await sharp(original).png().toBuffer()
      : original;
    const info = await sharp(bytes, { failOn: "error" }).metadata();
    if (!info.width || !info.height || info.format !== "png")
      throw new Error(`Invalid icon: ${input.path}`);
    const variants = await buildVariants({
      bytes,
      mimeType: "image/png",
      width: info.width,
      height: info.height,
    });
    const sourceHash = sha256(original);
    const clientVersion =
      input.group === "supplement" ? null : manifest.nativeClientVersion;
    const identity = {
      provider: MAP_ICON_PROVIDER,
      key: input.key,
      sourceHash,
      bundleManifestSha,
      variants: variants.map((v) => v.contentSha256),
    };
    const objectSha256 = canonicalJsonSha256(identity);
    assets.push({
      entityType: input.group === "hero" ? "hero" : "unit",
      entityKey: input.key,
      assetKind: "icon",
      requestedLogicalPath: input.path,
      resolvedLogicalPath: input.path,
      resolutionKind: "exact",
      sourceStatus: "available",
      sourceRepository: input.sourceRepository ?? null,
      sourceCommit: input.sourceCommit ?? null,
      clientVersion,
      sourceContentSha256: sha256(bytes),
      objectSha256,
      providerVersion: MAP_ICON_PROVIDER,
      metadata: {
        map_icon_key: input.key,
        source_repository: input.sourceRepository ?? null,
        source_commit: input.sourceCommit ?? null,
        source_path: input.sourcePath ?? input.path,
        source_url: input.sourceUrl ?? null,
        source_sha256: sourceHash,
        client_version: clientVersion,
        imported_at: new Date().toISOString(),
        importer_version: MAP_ICON_PROVIDER,
        schema_version: "map-icon-manifest/1",
        bundle_manifest_sha256: bundleManifestSha,
        native_vpk_sha256: clientVersion
          ? "09280034bfc7f3e978be36902189a8b1083e4c2eaaeccdb5fddee6ddfd371d83"
          : null,
        evidence: input.evidence,
        conversion: input.path.endsWith(".svg")
          ? "SVG to PNG at native dimensions"
          : null,
      },
      variants,
    });
    entries.push({
      key: input.key,
      label: input.label,
      group: input.group,
      sourcePath: input.path,
      sourceSha256: sourceHash,
      objectSha256,
      width: info.width,
      height: info.height,
      clientVersion,
    });
  }
  const bindings = json<{
    mapSha256: string;
    points: Array<{
      id: string;
      kind: string;
      iconKey: string | null;
      status: string;
    }>;
  }>("map-object-bindings.json");
  const keys = new Set(entries.map((e) => e.key));
  const points: Record<string, string> = {};
  const missing: string[] = [];
  for (const point of bindings.points) {
    if (point.kind === "tree") continue;
    if (point.status === "missing-source-key") {
      missing.push(point.id);
      continue;
    }
    const key = point.kind === "fountain" ? "hud_fountain" : point.iconKey;
    if (!key || !keys.has(key) || points[point.id])
      throw new Error(`Invalid map binding: ${point.id}`);
    points[point.id] = key;
  }
  const unitIcons = Object.fromEntries(
    json<Array<{ entityKey: string; iconKey: string; status: string }>>(
      "unit-bindings.json",
    )
      .filter((u) => keys.has(u.iconKey))
      .map((u) => [u.entityKey, u.iconKey]),
  );
  unitIcons.npc_dota_lantern = "minimap_watcher";
  unitIcons.dota_fountain = "hud_fountain";
  return {
    assets,
    body: {
      schemaVersion: 1,
      providerVersion: MAP_ICON_PROVIDER,
      bundleVersion: manifest.bundleVersion,
      bundleManifestSha256: bundleManifestSha,
      verifiedFiles: files.size,
      clientVersion: manifest.nativeClientVersion,
      sourceCommit: MAP_ICON_SOURCE_COMMIT,
      unitSourceSha256: sha256(files.get("raw/scripts/npc/npc_units.txt")!),
      unitIcons,
      mapRevision: bindings.mapSha256,
      points,
      missing,
      assets: entries,
    },
  };
}
