import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  DATABASE_ROLES,
  type DatabaseRole,
  type RuntimeEnvironment,
} from "@/domain/environment";
import {
  ensureMedota2StateDirectory,
  getMedota2StateDirectory,
} from "./medota2-state";

const credentialUrl = z.string().url().startsWith("postgresql://");
const roleCredentials = z
  .object(
    Object.fromEntries(
      DATABASE_ROLES.map((role) => [role, credentialUrl]),
    ) as Record<DatabaseRole, typeof credentialUrl>,
  )
  .strict();

const localDatabaseCredentials = z
  .object({
    contractVersion: z.literal(1),
    databases: z
      .object({
        development: roleCredentials,
        test: roleCredentials,
        "local-review": roleCredentials,
      })
      .strict(),
  })
  .strict();

export type LocalDatabaseCredentials = z.infer<typeof localDatabaseCredentials>;

export function readLocalDatabaseCredentials(): LocalDatabaseCredentials | null {
  const path = getLocalDatabaseCredentialsPath();
  if (!existsSync(path)) return null;
  assertPrivateRegularFile(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error("The local database credential receipt is unreadable.", {
      cause: error,
    });
  }
  const result = localDatabaseCredentials.safeParse(parsed);
  if (!result.success) {
    throw new Error("The local database credential receipt is invalid.");
  }
  return result.data;
}

export function getLocalDatabaseCredentialUrl(
  environment: Exclude<RuntimeEnvironment, "production">,
  role: DatabaseRole,
): string | null {
  return readLocalDatabaseCredentials()?.databases[environment][role] ?? null;
}

export function writeLocalDatabaseCredentials(
  credentials: LocalDatabaseCredentials,
): string {
  const validated = localDatabaseCredentials.parse(credentials);
  const path = getLocalDatabaseCredentialsPath();
  const directory = ensureMedota2StateDirectory();
  const temporaryPath = resolve(
    directory,
    ".database-credentials.v1." + randomUUID() + ".tmp",
  );
  try {
    writeFileSync(temporaryPath, JSON.stringify(validated, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, path);
  } catch (error) {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
  return path;
}

export function getLocalDatabaseCredentialsPath(): string {
  return resolve(getMedota2StateDirectory(), "database-credentials.v1.json");
}

function assertPrivateRegularFile(path: string): void {
  const metadata = lstatSync(path);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "The local database credential receipt must be a regular 0600 file owned by the current user.",
    );
  }
}
