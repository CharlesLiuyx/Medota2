import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { readJson, writeJson } from "./runtime";

// These are alert thresholds, not permission to delete business data or evidence.
const budgets: Record<string, number> = {
  ".medota2/shared-tests": 768,
  ".medota2/test-runs": 256,
  ".medota2/sessions": 256,
  ".medota2/cache": 1536,
  ".medota2/data-sync": 2048,
  ".medota2/releases": 384,
  ".next": 1536,
  ".next-release": 768,
  output: 512,
  node_modules: 1024,
  ".medota2/linux-visual": 512,
};
export async function auditStorage(root = process.cwd()) {
  async function bytes(path: string): Promise<number> {
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) return 0;
    if (!info.isDirectory()) return info.size; // Never traverse links/junctions.
    let size = 0;
    for (const entry of await readdir(path))
      size += await bytes(resolve(path, entry));
    return size;
  }
  const entries: Array<{
    path: string;
    bytes: number;
    budgetBytes: number | null;
    warning: boolean;
  }> = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const paths =
      entry.name === ".medota2" && entry.isDirectory()
        ? (await readdir(resolve(root, entry.name))).map(
            (name) => `${entry.name}/${name}`,
          )
        : [entry.name];
    for (const path of paths) {
      const size = await bytes(resolve(root, path));
      const budgetBytes = (budgets[path] ?? 256) * 1024 ** 2;
      entries.push({
        path,
        bytes: size,
        budgetBytes,
        warning: budgetBytes !== null && size > budgetBytes,
      });
    }
  }
  entries.sort((a, b) => b.bytes - a.bytes);
  return {
    measuredAt: new Date().toISOString(),
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    entries,
  };
}

export async function reportStorageBudget(): Promise<void> {
  if (process.env.CI) return;
  try {
    const path = resolve(".medota2/maintenance/storage-audit.json");
    const previous = await readJson<{ measuredAt: string }>(path);
    if (previous && Date.now() - Date.parse(previous.measuredAt) < 86400000)
      return;
    const audit = await auditStorage();
    await writeJson(path, audit);
    for (const entry of audit.entries.filter((item) => item.warning))
      console.warn(
        `[storage] ${entry.path}: ${(entry.bytes / 1024 ** 2).toFixed(0)} MiB exceeds ${(entry.budgetBytes! / 1024 ** 2).toFixed(0)} MiB budget. Run pnpm storage:audit; preserve data and review the cause before cleanup.`,
      );
  } catch (error) {
    console.warn(
      "Storage audit deferred:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
