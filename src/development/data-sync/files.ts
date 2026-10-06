import { mkdir, readFile, writeFile, rename, lstat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { assertOwnedPath } from "@/config/data-sync-state";
import { sha256, hashSchema, type FileIdentity } from "./protocol";

export function blobPath(root: string, hash: string): string {
  hashSchema.parse(hash);
  return assertOwnedPath(resolve(root, "objects", hash), root);
}
export function chunkPath(root: string, hash: string): string {
  hashSchema.parse(hash);
  return assertOwnedPath(resolve(root, "tables", `${hash}.ndjson`), root);
}
export async function putFile(
  path: string,
  bytes: Buffer | string,
): Promise<FileIdentity> {
  const data = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
  const identity = { sha256: sha256(data), bytes: data.length };
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, data, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await verifiedFile(path, identity);
  }
  return identity;
}
export async function putBlob(
  root: string,
  bytes: Buffer,
): Promise<FileIdentity> {
  return putFile(blobPath(root, sha256(bytes)), bytes);
}
export async function verifiedFile(
  path: string,
  identity: FileIdentity,
): Promise<Buffer> {
  const meta = await lstat(path);
  if (!meta.isFile() || meta.isSymbolicLink() || meta.size !== identity.bytes)
    throw new Error(
      `Missing, symbolic, or incomplete snapshot object: ${identity.sha256}`,
    );
  const bytes = await readFile(path);
  if (sha256(bytes) !== identity.sha256)
    throw new Error(`Snapshot checksum mismatch: ${identity.sha256}`);
  return bytes;
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}
