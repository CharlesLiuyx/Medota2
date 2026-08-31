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
import type { RuntimeEnvironment } from "@/domain/environment";
import {
  ensureMedota2StateDirectory,
  getMedota2StateDirectory,
} from "./medota2-state";

const receiptDatabase = z
  .object({
    databaseId: z.uuid(),
    databaseName: z.string().min(1),
    dataClass: z.enum(["sandbox", "synthetic-fixture", "production-snapshot"]),
  })
  .strict();

const localEnvironmentReceipt = z
  .object({
    contractVersion: z.literal(1),
    instanceId: z.uuid(),
    postgresSystemIdentifier: z.string().regex(/^[0-9]{1,20}$/u),
    databases: z
      .object({
        development: receiptDatabase.extend({
          databaseName: z.literal("medota2"),
          dataClass: z.literal("sandbox"),
        }),
        test: receiptDatabase.extend({
          databaseName: z.literal("medota2_test"),
          dataClass: z.literal("synthetic-fixture"),
        }),
        "local-review": receiptDatabase.extend({
          databaseName: z.literal("medota2_local"),
          dataClass: z.literal("production-snapshot"),
        }),
      })
      .strict(),
  })
  .strict();

export type LocalEnvironmentReceipt = z.infer<typeof localEnvironmentReceipt>;

export function getLocalEnvironmentReceiptIdentity(
  environment: Exclude<RuntimeEnvironment, "production">,
): {
  instanceId: string;
  databaseId: string;
  postgresSystemIdentifier: string;
} | null {
  const receipt = readLocalEnvironmentReceipt();
  if (!receipt) return null;
  return {
    instanceId: receipt.instanceId,
    databaseId: receipt.databases[environment].databaseId,
    postgresSystemIdentifier: receipt.postgresSystemIdentifier,
  };
}

export function readLocalEnvironmentReceipt(): LocalEnvironmentReceipt | null {
  const path = getLocalEnvironmentReceiptPath();
  if (!existsSync(path)) return null;
  const metadata = lstatSync(path);
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "The local environment identity receipt must be a regular 0600 file owned by the current user.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error("The local environment identity receipt is unreadable.", {
      cause: error,
    });
  }
  const result = localEnvironmentReceipt.safeParse(parsed);
  if (!result.success) {
    throw new Error("The local environment identity receipt is invalid.");
  }
  return result.data;
}

export function writeLocalEnvironmentReceipt(
  receipt: LocalEnvironmentReceipt,
): string {
  const validated = localEnvironmentReceipt.parse(receipt);
  const path = getLocalEnvironmentReceiptPath();
  const directory = ensureMedota2StateDirectory();
  const temporaryPath = resolve(
    directory,
    ".environment-identities.v1." + randomUUID() + ".tmp",
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

export function getLocalEnvironmentReceiptPath(): string {
  return resolve(getMedota2StateDirectory(), "environment-identities.v1.json");
}
