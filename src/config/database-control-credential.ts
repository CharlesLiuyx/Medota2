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
  ensureMedota2StateDirectory,
  getMedota2StateDirectory,
} from "./medota2-state";

const controlCredential = z
  .object({
    contractVersion: z.literal(1),
    controlUrl: z.string().url().startsWith("postgresql://"),
  })
  .strict();

export type LocalDatabaseControlCredential = z.infer<typeof controlCredential>;

export function readLocalDatabaseControlCredential(): LocalDatabaseControlCredential | null {
  const path = getLocalDatabaseControlCredentialPath();
  if (!existsSync(path)) return null;
  const metadata = lstatSync(path);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "The local database control credential must be a regular 0600 file owned by the current user.",
    );
  }
  const result = controlCredential.safeParse(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  if (!result.success) {
    throw new Error("The local database control credential is invalid.");
  }
  return result.data;
}

export function writeLocalDatabaseControlCredential(
  credential: LocalDatabaseControlCredential,
): string {
  const validated = controlCredential.parse(credential);
  const path = getLocalDatabaseControlCredentialPath();
  const directory = ensureMedota2StateDirectory();
  const temporaryPath = resolve(
    directory,
    ".database-control-credential.v1." + randomUUID() + ".tmp",
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

function getLocalDatabaseControlCredentialPath(): string {
  return resolve(
    getMedota2StateDirectory(),
    "database-control-credential.v1.json",
  );
}
