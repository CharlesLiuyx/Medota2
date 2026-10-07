import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readJson, writeJson } from "@/development/runtime";

export interface PublicationReceipt {
  version: 1;
  id: string;
  startedAt: string;
  updatedAt: string;
  status: "running" | "failed" | "published" | "passed";
  branch: string;
  remote: string;
  remoteRef: string;
  repository: string;
  base: string;
  tree: string;
  codeCommit?: string;
  snapshotId?: string;
  finalCommit?: string;
  ciUrl?: string;
  stages: Array<{
    name: string;
    status: "running" | "passed" | "failed";
    startedAt: string;
    durationMs?: number;
    error?: string;
  }>;
}
export const latestReceipt = resolve(".medota2/publications/latest.json");
export function createReceipt(
  input: Pick<
    PublicationReceipt,
    "branch" | "remote" | "remoteRef" | "repository" | "base" | "tree"
  >,
): PublicationReceipt {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
    startedAt: now,
    updatedAt: now,
    status: "running",
    stages: [],
    ...input,
  };
}
export async function saveReceipt(receipt: PublicationReceipt) {
  receipt.updatedAt = new Date().toISOString();
  await writeJson(
    resolve(".medota2/publications", receipt.id, "run.json"),
    receipt,
  );
  await writeJson(latestReceipt, receipt);
}
export async function readLatestReceipt() {
  return readJson<PublicationReceipt>(latestReceipt);
}
export async function stage<T>(
  receipt: PublicationReceipt,
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  const entry: PublicationReceipt["stages"][number] = {
    name,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  receipt.stages.push(entry);
  await saveReceipt(receipt);
  console.log(`[push] ${name}: started`);
  try {
    const result = await work();
    entry.status = "passed";
    return result;
  } catch (error) {
    entry.status = "failed";
    entry.error = error instanceof Error ? error.message : String(error);
    receipt.status = "failed";
    throw error;
  } finally {
    entry.durationMs = Date.now() - started;
    await saveReceipt(receipt);
    console.log(
      `[push] ${name}: ${entry.status}, ${(entry.durationMs / 1000).toFixed(1)}s`,
    );
  }
}

export function summarizeReceipts(receipts: PublicationReceipt[]) {
  return receipts.map((receipt) => ({
    id: receipt.id,
    status: receipt.status,
    commit: receipt.finalCommit ?? receipt.codeCommit,
    snapshotId: receipt.snapshotId,
    ciUrl: receipt.ciUrl,
    elapsedMs: Date.parse(receipt.updatedAt) - Date.parse(receipt.startedAt),
    executionMs: receipt.stages.reduce(
      (sum, entry) => sum + (entry.durationMs ?? 0),
      0,
    ),
    failedStages: receipt.stages
      .filter((entry) => entry.status === "failed")
      .map((entry) => entry.name),
    stages: receipt.stages.map(({ name, status, durationMs }) => ({
      name,
      status,
      durationMs,
    })),
  }));
}
export async function recentPublications() {
  const { readdir } = await import("node:fs/promises");
  const root = resolve(".medota2/publications");
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    },
  );
  const names = entries
    .filter(
      (entry) => entry.isDirectory() && /^\d+-[a-f0-9]+$/.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort()
    .reverse()
    .slice(0, 10);
  const receipts = await Promise.all(
    names.map((name) =>
      readJson<PublicationReceipt>(resolve(root, name, "run.json")),
    ),
  );
  return summarizeReceipts(
    receipts.filter((value): value is PublicationReceipt => value !== null),
  );
}
