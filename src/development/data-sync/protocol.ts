import { createHash } from "node:crypto";
import { z } from "zod";

export const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(",")}}`;
}
export const digest = (value: unknown) => sha256(canonical(value));
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const commitSchema = z.string().regex(/^[a-f0-9]{40}$/);
export const fileSchema = z
  .object({ sha256: hashSchema, bytes: z.number().int().nonnegative() })
  .strict();
export type FileIdentity = z.infer<typeof fileSchema>;
export const sourceFileSchema = fileSchema
  .extend({ path: z.string().min(1) })
  .strict();
export const sourceSchema = z
  .object({
    repository: z.string().min(1),
    url: z.string().url(),
    commit: commitSchema,
    files: z.array(sourceFileSchema).min(1),
  })
  .strict();
export const tableSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/),
    rows: z.number().int().nonnegative(),
    chunks: z.array(fileSchema),
  })
  .strict();
export const manifestSchema = z
  .object({
    version: z.literal(1),
    exporter: z.literal("medota2-snapshot/1"),
    codeCommit: commitSchema,
    exportedAt: z.iso.datetime(),
    parents: z.array(hashSchema),
    schemaDigest: hashSchema,
    migrationsDigest: hashSchema,
    environment: z.enum(["development", "local-review"]),
    databaseDigest: hashSchema,
    tables: z.array(tableSchema).min(1),
    objects: z.array(fileSchema),
    sources: z.array(sourceSchema),
    map: z
      .object({ files: z.array(sourceFileSchema).min(2) })
      .strict()
      .nullable(),
    heads: z.record(
      z.string(),
      z.array(z.record(z.string(), z.string().nullable())),
    ),
  })
  .strict();
export type SnapshotManifest = z.infer<typeof manifestSchema>;
export const dataLockSchema = z
  .object({
    version: z.literal(1),
    repository: z.literal("medota2-development-data"),
    commit: commitSchema,
    snapshotId: hashSchema,
    manifestSha256: hashSchema,
    schemaDigest: hashSchema,
    migrationsDigest: hashSchema,
  })
  .strict();
export type DataLock = z.infer<typeof dataLockSchema>;
export function snapshotId(manifest: SnapshotManifest): string {
  // Export time / source code history are evidence, not business content.
  return digest({
    version: manifest.version,
    schemaDigest: manifest.schemaDigest,
    migrationsDigest: manifest.migrationsDigest,
    environment: manifest.environment,
    databaseDigest: manifest.databaseDigest,
    sources: manifest.sources,
    map: manifest.map,
  });
}
export type TextRow = Record<string, string | null>;

export function hasUnexportedChanges(input: {
  current: string | null;
  target: string;
  baseline: string | null;
  exported: string | null;
  nonempty: boolean;
}): boolean {
  return Boolean(
    input.current &&
    (input.nonempty || input.baseline) &&
    input.current !== input.target &&
    input.current !== input.baseline &&
    input.current !== input.exported,
  );
}

export function assertRelativeFile(path: string): void {
  if (
    !/^[a-zA-Z0-9_.\/-]+$/.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid snapshot file path.");
}
export function assertPublishableText(text: string, label: string): void {
  if (
    /(?:postgres(?:ql)?:\/\/|https?:\/\/[^\s/@]+:[^\s/@]+@|sk-[A-Za-z0-9_-]{24,}|\/Users\/|\/home\/|[A-Z]:\\+Users\\+)/i.test(
      text,
    )
  )
    throw new Error(
      `Snapshot contains a credential-like value or machine path in ${label}; review before export.`,
    );
}
