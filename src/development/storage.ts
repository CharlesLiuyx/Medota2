import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { z } from "zod";
import { loadLocalEnv } from "@/config/env";
import { acquireLock, processAlive, readJson, writeJson } from "./runtime";

const policySchema = z
  .object({
    releases: z.number().int().min(1).max(100).default(2),
    successfulTests: z.number().int().min(1).max(1000).default(10),
    failedTests: z.number().int().min(1).max(1000).default(5),
    failureGraceDays: z.number().int().min(1).max(365).default(7),
    logMaxBytes: z
      .number()
      .int()
      .min(1024)
      .max(100 * 1024 * 1024)
      .default(10 * 1024 * 1024),
    logArchives: z.number().int().min(1).max(10).default(3),
  })
  .strict();
export type StoragePolicy = z.infer<typeof policySchema>;
export type StorageScope = "releases" | "tests";
export const defaultStoragePolicy = policySchema.parse({});
export interface StorageAction {
  path: string;
  kind: "directory" | "duplicate-trace";
  reason: string;
  bytes: number;
  retained?: string;
  sha256?: string;
}
export interface StoragePlan {
  policy: StoragePolicy;
  actions: StorageAction[];
  retained: Array<{ path: string; reason: string }>;
  bytes: number;
}

/** Reject links on every component, including Windows junctions. */
export async function managedStoragePath(
  root: string,
  path: string,
): Promise<string> {
  const base = resolve(root),
    full = resolve(base, path),
    suffix = relative(base, full);
  if (path.replaceAll("\\", "/").split("/").includes(".."))
    throw new Error("Storage paths cannot contain parent traversal.");
  if (!suffix || suffix === ".." || suffix.startsWith(`..${sep}`))
    throw new Error("Storage path must remain inside the workspace.");
  let current = base;
  for (const part of suffix.split(sep)) {
    current = resolve(current, part);
    const info = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info?.isSymbolicLink())
      throw new Error(`Storage cleanup refuses links: ${path}`);
  }
  return full;
}
async function exists(root: string, path: string): Promise<boolean> {
  return lstat(await managedStoragePath(root, path))
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
}
async function directories(root: string, path: string): Promise<string[]> {
  const full = await managedStoragePath(root, path);
  const entries = await readdir(full, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${path}/${entry.name}`);
}
async function treeBytes(root: string, path: string): Promise<number> {
  const full = await managedStoragePath(root, path);
  async function visit(current: string): Promise<number> {
    const info = await lstat(current);
    // Standalone dependencies include links. Count and remove only the link,
    // never its destination; candidate paths themselves cannot be links.
    if (info.isFile() || info.isSymbolicLink()) return info.size;
    if (!info.isDirectory())
      throw new Error(`Unexpected storage entry: ${current}`);
    let bytes = 0;
    for (const name of await readdir(current))
      bytes += await visit(resolve(current, name));
    return bytes;
  }
  return visit(full);
}
async function digest(root: string, path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(
    await managedStoragePath(root, path),
  ))
    hash.update(chunk);
  return hash.digest("hex");
}
export async function readStoragePolicy(
  root = process.cwd(),
): Promise<StoragePolicy> {
  const path = await managedStoragePath(root, ".medota2/storage-policy.json");
  return policySchema.parse((await readJson<unknown>(path)) ?? {});
}
interface RecordEntry {
  path: string;
  status: string;
  time: number;
  legacyFailure: boolean;
}
const terminal = new Set(["passed", "failed", "stale", "interrupted"]);
const attachments = ["report", "test-results", "playwright"];
const safeDirectory =
  /^(?:\.medota2\/releases\/[a-f0-9]{64}|\.medota2\/shared-tests\/runs\/\d+-[a-f0-9-]+\/(?:report|test-results|playwright)|\.medota2\/test-runs\/(?:integration|e2e|verify)-[a-z0-9-]+\/(?:artifacts|next))$/;
const safeTrace =
  /^\.medota2\/(?:shared-tests\/runs\/\d+-[a-f0-9-]+|test-runs\/(?:integration|e2e|verify)-[a-z0-9-]+)\/(?:test-results|artifacts\/test-results)\/.+\.zip$/;

export async function buildStoragePlan(
  options: {
    root?: string;
    scope?: StorageScope;
    preserve?: readonly string[];
    now?: number;
  } = {},
): Promise<StoragePlan> {
  const root = resolve(options.root ?? process.cwd()),
    now = options.now ?? Date.now();
  const policy = await readStoragePolicy(root);
  const plan: StoragePlan = { policy, actions: [], retained: [], bytes: 0 };
  const preserve = new Set(
    (options.preserve ?? []).map((path) =>
      relative(root, resolve(root, path)).replaceAll("\\", "/"),
    ),
  );
  async function pinned(path: string): Promise<boolean> {
    return preserve.has(path) || (await exists(root, `${path}/.keep`));
  }
  async function add(path: string, reason: string): Promise<void> {
    if (!safeDirectory.test(path))
      throw new Error(`Unsupported cleanup directory: ${path}`);
    if (await exists(root, path))
      plan.actions.push({
        path,
        reason,
        kind: "directory",
        bytes: await treeBytes(root, path),
      });
  }
  if (!options.scope || options.scope === "releases") {
    const records: RecordEntry[] = [];
    for (const path of await directories(root, ".medota2/releases")) {
      if (!/^[a-f0-9]{64}$/.test(path.split("/").at(-1)!)) continue;
      const entry = await readJson<{
        status?: string;
        builtAt?: string;
        finishedAt?: string;
        key?: string;
        pid?: number;
      }>(await managedStoragePath(root, `${path}/manifest.json`));
      const time = Date.parse(entry?.builtAt ?? entry?.finishedAt ?? "");
      if (
        !entry ||
        entry.key !== path.split("/").at(-1) ||
        !terminal.has(entry.status ?? "") ||
        !Number.isFinite(time)
      ) {
        plan.retained.push({ path, reason: "构建中或没有可识别的完成记录" });
        continue;
      }
      records.push({
        path,
        status: entry.status!,
        time,
        legacyFailure: entry.status !== "passed" && !entry.pid,
      });
    }
    records.sort((a, b) => b.time - a.time);
    let passed = 0,
      failed = 0;
    for (const entry of records) {
      const recent =
        entry.status === "passed"
          ? passed++ < policy.releases
          : failed++ < policy.failedTests;
      const keep =
        (await pinned(entry.path)) ||
        recent ||
        entry.legacyFailure ||
        (entry.status !== "passed" &&
          now - entry.time < policy.failureGraceDays * 86400000);
      if (keep)
        plan.retained.push({
          path: entry.path,
          reason: "近期版本、固定保留或失败诊断",
        });
      else await add(entry.path, "已超过发布保留范围");
    }
  }
  if (!options.scope || options.scope === "tests") {
    const records: RecordEntry[] = [];
    const lease = await readJson<{ context: { runRoot: string } }>(
      await managedStoragePath(root, ".medota2/shared-tests/environment.json"),
    );
    const leaseRoot = lease ? resolve(lease.context.runRoot) : null;
    for (const parent of [".medota2/shared-tests/runs", ".medota2/test-runs"]) {
      for (const path of await directories(root, parent)) {
        if (leaseRoot === resolve(root, path)) {
          plan.retained.push({ path, reason: "共享测试租约正在引用" });
          continue;
        }
        const entry = await readJson<{
          status?: string;
          finishedAt?: string;
          pid?: number;
          cleanup?: { status: string; databaseRetained: boolean };
        }>(await managedStoragePath(root, `${path}/run.json`));
        const time = Date.parse(entry?.finishedAt ?? "");
        const isolated = parent.endsWith("test-runs");
        if (
          !entry ||
          !terminal.has(entry.status ?? "") ||
          !Number.isFinite(time) ||
          (isolated &&
            (entry.cleanup?.status !== "cleaned" ||
              entry.cleanup.databaseRetained))
        ) {
          plan.retained.push({
            path,
            reason:
              entry?.pid && processAlive(entry.pid)
                ? "测试仍在运行"
                : "未完成记录或数据库仍需保留",
          });
          continue;
        }
        if (await pinned(path)) {
          plan.retained.push({ path, reason: "固定保留" });
          continue;
        }
        records.push({
          path,
          status: entry.status!,
          time,
          legacyFailure:
            entry.status !== "passed" &&
            !entry.pid &&
            !(await exists(root, `${path}/.resolved`)),
        });
      }
    }
    records.sort((a, b) => b.time - a.time);
    let passed = 0,
      failed = 0;
    for (const entry of records) {
      const keep =
        entry.status === "passed"
          ? passed++ < policy.successfulTests
          : failed++ < policy.failedTests ||
            entry.legacyFailure ||
            now - entry.time < policy.failureGraceDays * 86400000;
      const isolated = entry.path.startsWith(".medota2/test-runs/");
      if (!keep) {
        for (const folder of isolated ? ["artifacts", "next"] : attachments)
          await add(
            `${entry.path}/${folder}`,
            "已超过测试完整附件保留范围；摘要和日志保留",
          );
      } else {
        plan.retained.push({
          path: entry.path,
          reason: "近期测试或待解决失败",
        });
        const result = `${entry.path}/${isolated ? "artifacts/" : ""}test-results`;
        const report = `${entry.path}/${isolated ? "artifacts/" : ""}report/data`;
        if (!(await exists(root, result)) || !(await exists(root, report)))
          continue;
        const copies = new Map<number, string[]>();
        for (const name of await readdir(
          await managedStoragePath(root, report),
        )) {
          if (!name.endsWith(".zip")) continue;
          const path = `${report}/${name}`,
            size = (await lstat(await managedStoragePath(root, path))).size;
          copies.set(size, [...(copies.get(size) ?? []), path]);
        }
        async function visit(path: string): Promise<void> {
          for (const name of await readdir(
            await managedStoragePath(root, path),
            { withFileTypes: true },
          )) {
            const file = `${path}/${name.name}`;
            if (name.isSymbolicLink())
              throw new Error(`Storage cleanup refuses links: ${file}`);
            if (name.isDirectory()) await visit(file);
            else if (name.isFile() && name.name.endsWith(".zip")) {
              const size = (await lstat(await managedStoragePath(root, file)))
                .size;
              const candidates = copies.get(size) ?? [];
              if (!candidates.length) continue;
              const hash = await digest(root, file);
              for (const retained of candidates)
                if (hash === (await digest(root, retained))) {
                  if (!safeTrace.test(file))
                    throw new Error(`Unsupported trace path: ${file}`);
                  plan.actions.push({
                    path: file,
                    kind: "duplicate-trace",
                    reason: "完整HTML报告保留相同附件",
                    bytes: size,
                    retained,
                    sha256: hash,
                  });
                  break;
                }
            }
          }
        }
        await visit(result);
      }
    }
  }
  plan.bytes = plan.actions.reduce((sum, entry) => sum + entry.bytes, 0);
  return plan;
}

/** Caller holds the scope locks. A plan can never select state/data directories. */
export async function executeStoragePlan(
  plan: StoragePlan,
  root = process.cwd(),
): Promise<void> {
  for (const entry of plan.actions) {
    const path = await managedStoragePath(root, entry.path);
    const owner = entry.path.startsWith(".medota2/releases/")
      ? entry.path.split("/").slice(0, 3).join("/")
      : entry.path.startsWith(".medota2/shared-tests/")
        ? entry.path.split("/").slice(0, 4).join("/")
        : entry.path.split("/").slice(0, 3).join("/");
    if (await exists(root, `${owner}/.keep`))
      throw new Error(`Storage candidate was pinned: ${owner}`);
    if (entry.kind === "directory") {
      if (!safeDirectory.test(entry.path))
        throw new Error("Unsupported cleanup directory.");
      // Recheck descendants before recursive removal; do not follow links.
      if ((await treeBytes(root, entry.path)) !== entry.bytes)
        throw new Error(`Storage candidate changed: ${entry.path}`);
      if (entry.path.startsWith(".medota2/releases/")) {
        const manifest = await readJson<unknown>(
          await managedStoragePath(root, `${owner}/manifest.json`),
        );
        await writeJson(
          await managedStoragePath(
            root,
            `.medota2/maintenance/releases/${owner.split("/").at(-1)}.json`,
          ),
          { removedAt: new Date().toISOString(), manifest },
        );
      }
      await rm(path, { recursive: true });
    } else {
      if (
        !safeTrace.test(entry.path) ||
        !entry.retained ||
        !entry.retained.startsWith(`${owner}/`) ||
        !entry.sha256 ||
        !/\/(?:report\/data)\/[^/]+\.zip$/.test(entry.retained)
      )
        throw new Error("Unsupported duplicate trace.");
      if (
        (await digest(root, entry.path)) !== entry.sha256 ||
        (await digest(root, entry.retained)) !== entry.sha256
      )
        throw new Error(`Trace changed: ${entry.path}`);
      await rm(path);
    }
    if (!entry.path.startsWith(".medota2/releases/")) {
      const marker = await managedStoragePath(
        root,
        `${owner}/storage-cleanup.json`,
      );
      const previous = await readJson<{ changes: StorageAction[] }>(marker);
      await writeJson(marker, {
        cleanedAt: new Date().toISOString(),
        changes: [...(previous?.changes ?? []), entry],
      });
    }
  }
}

export async function maintainStorage(
  options: {
    apply?: boolean;
    scope?: StorageScope;
    preserve?: readonly string[];
  } = {},
): Promise<StoragePlan> {
  const releases: Array<() => Promise<void>> = [];
  try {
    if (options.apply) {
      for (const name of [
        ...(!options.scope || options.scope === "releases" ? ["release"] : []),
        ...(!options.scope || options.scope === "tests"
          ? ["test-database"]
          : []),
        "storage",
      ])
        releases.push(await acquireLock(name, 0));
    }
    const plan = await buildStoragePlan(options);
    if (options.apply) {
      const receipt = await managedStoragePath(
        process.cwd(),
        ".medota2/maintenance/last-storage-cleanup.json",
      );
      await writeJson(receipt, {
        status: "running",
        startedAt: new Date().toISOString(),
        plan,
      });
      try {
        await executeStoragePlan(plan);
        await writeJson(receipt, {
          status: "passed",
          finishedAt: new Date().toISOString(),
          plan,
        });
      } catch (error) {
        await writeJson(receipt, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          plan,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
    return plan;
  } finally {
    for (const release of releases.reverse()) await release();
  }
}
export async function automaticStorageCleanup(
  scope: StorageScope,
  preserve: readonly string[] = [],
): Promise<void> {
  if (process.env.CI || process.env.MEDOTA2_AUTO_CLEANUP === "0") return;
  try {
    loadLocalEnv();
    if (process.env.MEDOTA2_AUTO_CLEANUP === "0") return;
    const plan = await maintainStorage({ apply: true, scope, preserve });
    if (plan.actions.length)
      console.log(
        `[storage] Removed ${plan.actions.length} generated entries (${(plan.bytes / 1048576).toFixed(1)} MiB of file content).`,
      );
  } catch (error) {
    console.warn(
      "Storage cleanup deferred:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
