import sharp from "sharp";
import { assertOutboundNetworkAllowed } from "@/config/network-policy";

export const REDOTA_REPOSITORY = "timkurvers/redota";
export async function readRedotaFile(
  commit: string,
  path: string,
): Promise<Buffer | null> {
  if (
    !/^[a-f0-9]{40}$/.test(commit) ||
    !/^[a-zA-Z0-9_./-]+$/.test(path) ||
    path.includes("..")
  )
    throw new Error("Invalid pinned portrait source.");
  assertOutboundNetworkAllowed(
    "https://raw.githubusercontent.com",
    "ReDota portraits",
  );
  const response = await fetch(
    `https://raw.githubusercontent.com/${REDOTA_REPOSITORY}/${commit}/${path}`,
    { redirect: "error", signal: AbortSignal.timeout(15000) },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error(`Portrait source returned ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty portrait response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 5 * 1024 * 1024) throw new Error("Portrait exceeds 5 MiB.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks);
}
export function parsePortraitModels(text: string): Map<string, string> {
  const models = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-z0-9_]+)\.jpg: model=([^&\s]+)&portrait(?:$|&|=)/.exec(
      line,
    );
    // Special materials/cameras must use explicit identity, never a generic model alias.
    if (match && !line.includes("&material=") && !line.includes("&portrait="))
      models.set(match[2], match[1]);
  }
  return models;
}
export async function readRedotaPortrait(commit: string, key: string) {
  if (!/^[a-z0-9_]+$/.test(key)) throw new Error("Invalid portrait key.");
  const path = `public/images/portraits/${key}.jpg`;
  const bytes = await readRedotaFile(commit, path);
  if (!bytes) return null;
  const meta = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: 16_777_216,
  }).metadata();
  if (meta.format !== "jpeg" || !meta.width || !meta.height)
    throw new Error("Invalid portrait JPEG.");
  return {
    bytes,
    width: meta.width,
    height: meta.height,
    mimeType: "image/jpeg",
    logicalPath: path,
    sourceUrl: `https://raw.githubusercontent.com/${REDOTA_REPOSITORY}/${commit}/${path}`,
  };
}
