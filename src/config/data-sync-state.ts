import { existsSync, lstatSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { z } from "zod";

export const syncRoot = () => resolve(".medota2/data-sync");
export const workspaceSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    environmentName: z.string().min(1).max(100),
    profile: z.enum(["local", "cloud-vm", "ephemeral"]),
    root: z.string(),
    webPort: z.number().int().min(1024).max(65535),
  })
  .strict();
export type SyncWorkspace = z.infer<typeof workspaceSchema>;
export const leaseSchema = z
  .object({
    contractVersion: z.literal(1),
    environment: z.enum(["development", "local-review"]),
    composeProject: z.string().regex(/^medota2-sync-[a-f0-9-]{36}$/),
    composeFile: z.string(),
    stateDirectory: z.string(),
    hostPort: z.number().int().min(1024).max(65535),
    persistence: z.literal("persistent"),
  })
  .strict();
export const activeSchema = z
  .object({
    version: z.literal(1),
    workspaceId: z.uuid(),
    candidateId: z.uuid(),
    snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    databaseDigest: z.string().regex(/^[a-f0-9]{64}$/),
    snapshotManifestPath: z.string().optional(),
    appliedAt: z.iso.datetime(),
    lease: leaseSchema,
    sourceRoot: z.string(),
    mapRoot: z.string().nullable(),
    mapCollectionPath: z.string().nullable().optional(),
    mapInputsAtApply: z
      .object({ collectionPath: z.string(), dataPath: z.string() })
      .optional(),
  })
  .strict();
export type ActiveSnapshot = z.infer<typeof activeSchema>;

export function assertOwnedPath(path: string, root = syncRoot()): string {
  const full = resolve(path),
    base = resolve(root);
  const suffix = relative(base, full);
  if (
    suffix === ".." ||
    suffix.startsWith(`..${sep}`) ||
    resolve(base, suffix) !== full
  )
    throw new Error("Data sync path must remain inside its managed root.");
  let current = base;
  for (const part of ["", ...suffix.split(sep).filter(Boolean)]) {
    if (part) current = resolve(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error("Data sync paths cannot traverse symbolic links.");
  }
  return full;
}

export function readSyncJson(path: string): unknown | null {
  assertOwnedPath(path);
  if (!existsSync(path)) return null;
  if (!lstatSync(path).isFile())
    throw new Error("Expected a regular sync state file.");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readSyncWorkspace(): SyncWorkspace | null {
  const raw = readSyncJson(resolve(syncRoot(), "workspace.json"));
  if (raw === null) return null;
  const workspace = workspaceSchema.parse(raw);
  if (workspace.root !== process.cwd())
    throw new Error(
      "Workspace receipt belongs to another checkout; initialize a new workspace without copying .medota2.",
    );
  return workspace;
}

export function readActiveSnapshot(): ActiveSnapshot | null {
  const raw = readSyncJson(resolve(syncRoot(), "active.json"));
  if (raw === null) return null;
  const active = activeSchema.parse(raw);
  const workspace = readSyncWorkspace();
  if (!workspace || workspace.id !== active.workspaceId)
    throw new Error("Active snapshot belongs to another workspace.");
  validateCandidateLease(active.candidateId, active.lease);
  assertOwnedPath(active.sourceRoot);
  if (active.mapRoot) assertOwnedPath(active.mapRoot);
  if (active.mapCollectionPath) assertOwnedPath(active.mapCollectionPath);
  if (active.snapshotManifestPath) assertOwnedPath(active.snapshotManifestPath);
  return active;
}

export function validateCandidateLease(
  id: string,
  lease: z.infer<typeof leaseSchema>,
): void {
  z.uuid().parse(id);
  leaseSchema.parse(lease);
  if (
    lease.composeProject !== `medota2-sync-${id}` ||
    lease.composeFile !== resolve("docker-compose.data-stack.yml") ||
    lease.stateDirectory !== resolve(syncRoot(), "candidates", id, "state")
  )
    throw new Error("Candidate lease does not match its exact managed stack.");
  assertOwnedPath(lease.stateDirectory);
}

export function getWorkbenchPort(): number {
  return readSyncWorkspace()?.webPort ?? 3000;
}
export function getWorkbenchOrigin(): string {
  return `http://127.0.0.1:${getWorkbenchPort()}`;
}

export function activeStateDirectory(
  configured: string | undefined,
): string | undefined {
  // Explicit test/candidate roots never redirect. Official environment scripts
  // continue to address the selected dataset after a verified activation.
  const value = configured?.replaceAll("\\", "/");
  if (
    value !== ".medota2/environments/local-review" &&
    value !== ".medota2/environments/development"
  )
    return configured;
  const active = readActiveSnapshot();
  return active && value === `.medota2/environments/${active.lease.environment}`
    ? active.lease.stateDirectory
    : configured;
}
