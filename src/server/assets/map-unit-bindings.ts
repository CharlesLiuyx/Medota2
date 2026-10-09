import type { VerifiedSession } from "@/server/environment/contract";
import { canonicalJsonSha256 } from "@/lib/hash";

type Binding = {
  key: string;
  objectId: string | null;
  resolution: string;
  provenance: Record<string, unknown>;
};
/** Fill missing images only, preserving the complete previous dataset and its evidence. */
export function supplementUnitBindings(
  previous: Binding[],
  icons: Record<
    string,
    { objectId: string; key: string; sourceSha256: string }
  >,
) {
  return previous.map((binding) => {
    const icon = icons[binding.key];
    return binding.resolution === "unavailable" && !binding.objectId && icon
      ? {
          ...binding,
          objectId: icon.objectId,
          resolution: "related_icon",
          provenance: {
            relation: "unit_minimap",
            icon_key: icon.key,
            source_sha256: icon.sourceSha256,
            client_version: "6944",
            reason: "Version-bound minimap artwork; not a unit portrait",
          },
        }
      : binding;
  });
}

export async function attachMissingUnitMapIcons(
  client: VerifiedSession,
  catalogId: string,
  icons: Parameters<typeof supplementUnitBindings>[1],
  bundleManifestSha256: string,
) {
  await client.query("SELECT pg_advisory_xact_lock(1296389185,1751740003)");
  const current = (
    await client.query<{
      id: string;
      expected_keys: string[];
      provenance: Record<string, unknown>;
    }>(
      "SELECT v.* FROM unit_asset_heads h JOIN unit_asset_dataset_versions v ON v.id=h.dataset_version_id WHERE h.catalog_dataset_version_id=$1",
      [catalogId],
    )
  ).rows[0];
  if (!current)
    throw new Error(
      "Import the initial unit asset dataset before supplementing map icons.",
    );
  const previous = (
    await client.query<Binding>(
      `SELECT unit_key AS key, asset_object_id AS "objectId", resolution, provenance FROM unit_asset_bindings WHERE dataset_version_id=$1 ORDER BY unit_key`,
      [current.id],
    )
  ).rows;
  const bindings = supplementUnitBindings(previous, icons);
  const added = bindings.filter((b, i) => b !== previous[i]).map((b) => b.key);
  if (!added.length) return { added, version: current.id };
  const manifest = canonicalJsonSha256({
    previous: current.id,
    bundleManifestSha256,
    bindings,
  });
  const inserted = await client.query<{ id: string }>(
    "INSERT INTO unit_asset_dataset_versions (catalog_dataset_version_id,manifest_sha256,expected_keys,provenance) VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING id",
    [
      catalogId,
      manifest,
      current.expected_keys,
      JSON.stringify({
        ...current.provenance,
        mapSupplement: {
          bundleManifestSha256,
          previousVersion: current.id,
          added,
        },
      }),
    ],
  );
  const version =
    inserted.rows[0]?.id ??
    (
      await client.query<{ id: string }>(
        "SELECT id FROM unit_asset_dataset_versions WHERE catalog_dataset_version_id=$1 AND manifest_sha256=$2",
        [catalogId, manifest],
      )
    ).rows[0].id;
  if (inserted.rowCount)
    for (const b of bindings)
      await client.query(
        "INSERT INTO unit_asset_bindings VALUES ($1,$2,$3,$4,$5::jsonb)",
        [
          version,
          b.key,
          b.objectId,
          b.resolution,
          JSON.stringify(b.provenance),
        ],
      );
  await client.query("SELECT promote_unit_asset_dataset($1)", [version]);
  return { added, version };
}
