export interface SteamVersion {
  clientVersion: string;
  sourceRevision: string;
  versionDate: string | null;
  versionTime: string | null;
}

export function parseSteamInf(source: string): SteamVersion {
  const values = new Map<string, string>();
  for (const line of source.split("\n")) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values.set(
      line.slice(0, separator).trim(),
      line.slice(separator + 1).trim(),
    );
  }
  const clientVersion = values.get("ClientVersion");
  const sourceRevision = values.get("SourceRevision");
  if (!clientVersion) throw new Error("steam.inf is missing ClientVersion.");
  if (!sourceRevision) throw new Error("steam.inf is missing SourceRevision.");

  return {
    clientVersion,
    sourceRevision,
    versionDate: values.get("VersionDate") || null,
    versionTime: values.get("VersionTime") || null,
  };
}
