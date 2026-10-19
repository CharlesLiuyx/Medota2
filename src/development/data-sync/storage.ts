import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { lstat, readdir, readFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { acquireLock, readJson, writeJson } from "@/development/runtime";
import { managedStoragePath, readStoragePolicy } from "@/development/storage";
import { atomicJson, putFile, verifiedFile } from "./files";
import { sha256 } from "./protocol";

const exec = promisify(execFile);
const compress = promisify(gzip),
  decompress = promisify(gunzip);
const base = ".medota2/data-sync";
const payload = /^(objects\/[a-f0-9]{64}|tables\/[a-f0-9]{64}\.ndjson)$/;
const staging =
  /^(export|bundles\/[a-f0-9]{64}|publication-exports\/[a-f0-9-]{36})$/;
type File = { path: string; sha256: string; bytes: number };
type Compacted = { version: 1; files: File[]; compactedAt: string };
export interface SyncStoragePlan {
  actions: Array<{ path: string; kind: "compact" | "cache"; bytes: number }>;
  retained: Array<{ path: string; reason: string }>;
}
async function path(root: string, name: string) {
  return managedStoragePath(root, `${base}/${name}`);
}
async function info(root: string, name: string) {
  return lstat(await path(root, name)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
}
async function children(root: string, name: string): Promise<string[]> {
  if (!(await info(root, name))) return [];
  return readdir(await path(root, name));
}
async function pinned(root: string, name: string) {
  for (const owner of [
    "",
    ...name.split("/").map((_, i, parts) => parts.slice(0, i + 1).join("/")),
  ])
    if (await info(root, `${owner ? `${owner}/` : ""}.keep`)) return true;
  return false;
}
async function tree(root: string, name: string): Promise<number> {
  const stat = await info(root, name);
  if (!stat) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory())
    throw new Error(`Unexpected sync storage entry: ${name}`);
  let bytes = 0;
  for (const child of await children(root, name))
    bytes += await tree(root, `${name}/${child}`);
  return bytes;
}
async function inventory(
  root: string,
  name: string,
): Promise<{ files: File[]; unique: number }> {
  const files: File[] = [];
  let unique = 0;
  for (const folder of ["objects", "tables"])
    for (const child of await children(root, `${name}/${folder}`)) {
      const file = `${folder}/${child}`;
      if (!payload.test(file))
        throw new Error(`Unknown payload file: ${name}/${file}`);
      const hash = child.replace(/\.ndjson$/, "");
      const stat = await info(root, `${name}/${file}`);
      if (!stat?.isFile())
        throw new Error(`Non-regular payload: ${name}/${file}`);
      const identity = { path: file, sha256: hash, bytes: stat.size };
      await verifiedFile(await path(root, `${name}/${file}`), identity);
      // Unique/unpublished bytes stay in place. Only proven duplicates are compacted.
      if (!(await info(root, `repository/${file}`))) {
        unique++;
        continue;
      }
      await verifiedFile(await path(root, `repository/${file}`), identity);
      files.push(identity);
    }
  return { files, unique };
}
function archive(file: File) {
  if (
    !payload.test(file.path) ||
    file.path.split("/")[1].replace(/\.ndjson$/, "") !== file.sha256 ||
    !Number.isSafeInteger(file.bytes) ||
    file.bytes < 0
  )
    throw new Error("Invalid compacted payload identity.");
  return `payload-archive/${file.path}.gz`;
}
async function archivedBytes(root: string, file: File): Promise<Buffer> {
  const data = await decompress(
    await readFile(await path(root, archive(file))),
  );
  if (data.length !== file.bytes || sha256(data) !== file.sha256)
    throw new Error(`Compacted payload checksum mismatch: ${file.path}`);
  return data;
}
function materializationReceipt(name: string) {
  return `storage-receipts/materialized-${sha256(Buffer.from(name))}.json`;
}
/** Successful explicit preparation starts a fresh idle period, even for an old snapshot. */
export async function markSyncPayloadUsed(
  name: string,
  root = process.cwd(),
): Promise<void> {
  if (!staging.test(name)) throw new Error("Unsupported compacted sync root.");
  await atomicJson(await path(root, materializationReceipt(name)), {
    name,
    usedAt: new Date().toISOString(),
  });
}

/** Caller holds data-sync. Only allowlisted staging roots can be materialized. */
export async function restoreSyncPayload(
  name: string,
  root = process.cwd(),
): Promise<number> {
  if (!staging.test(name)) throw new Error("Unsupported compacted sync root.");
  const marker = await readJson<Compacted>(
    await path(root, `${name}/compacted.json`),
  );
  if (!marker) {
    if (await info(root, name)) await markSyncPayloadUsed(name, root);
    return 0;
  }
  if (marker.version !== 1 || !Array.isArray(marker.files))
    throw new Error("Invalid compacted payload receipt.");
  // Verify all archive content before writing any restored file.
  for (const file of marker.files) await archivedBytes(root, file);
  for (const file of marker.files)
    await putFile(
      await path(root, `${name}/${file.path}`),
      await archivedBytes(root, file),
    );
  await markSyncPayloadUsed(name, root);
  await rm(await path(root, `${name}/compacted.json`));
  return marker.files.length;
}
async function referenced(root: string, name: string): Promise<boolean> {
  const target = resolve(root, base, name);
  const receipts = [
    "active.json",
    "switch.json",
    ...(await children(root, "candidates").then((ids) =>
      ids.map((id) => `candidates/${id}/candidate.json`),
    )),
  ];
  for (const receipt of receipts) {
    const value = await readJson<unknown>(await path(root, receipt));
    const visit = (item: unknown): boolean => {
      if (typeof item === "string") {
        const normalized = resolve(root, item);
        return (
          normalized === target || normalized.startsWith(`${target}${sep}`)
        );
      }
      return (
        item !== null &&
        typeof item === "object" &&
        Object.values(item).some(visit)
      );
    };
    if (visit(value)) return true;
  }
  return false;
}
/** Preview is read-only. Apply must be serialized with every sync/export/publication. */
export async function cleanSyncStorage(
  options: {
    root?: string;
    apply?: boolean;
    compact?: boolean;
    now?: number;
  } = {},
): Promise<SyncStoragePlan> {
  const root = resolve(options.root ?? process.cwd()),
    now = options.now ?? Date.now();
  const policy = await readStoragePolicy(root);
  const plan: SyncStoragePlan = { actions: [], retained: [] };
  const names = [
    "export",
    ...(await children(root, "bundles").then((ids) =>
      ids.map((id) => `bundles/${id}`),
    )),
    ...(await children(root, "publication-exports").then((ids) =>
      ids.map((id) => `publication-exports/${id}`),
    )),
  ];
  for (const name of names.filter((name) => staging.test(name))) {
    if (!(await info(root, name))) continue;
    try {
      if ((await pinned(root, name)) || (await referenced(root, name)))
        throw new Error("固定保留或活动候选引用");
      const manifests = await children(root, `${name}/snapshots`);
      if (!manifests.length) throw new Error("缺少快照清单");
      let latest = 0;
      for (const id of manifests) {
        if (!/^[a-f0-9]{64}$/.test(id)) throw new Error("未知快照目录");
        const manifest = await readJson<{ exportedAt: string }>(
          await path(root, `${name}/snapshots/${id}/manifest.json`),
        );
        const time = Date.parse(manifest?.exportedAt ?? "");
        if (!Number.isFinite(time)) throw new Error("缺少有效导出时间");
        latest = Math.max(latest, time);
      }
      const used = await readJson<{ name: string; usedAt: string }>(
        await path(root, materializationReceipt(name)),
      );
      if (used) {
        const time = Date.parse(used.usedAt);
        if (used.name !== name || !Number.isFinite(time))
          throw new Error("Invalid payload usage receipt.");
        latest = Math.max(latest, time);
      }
      if (!options.compact && now - latest < policy.syncIdleDays * 86400000)
        continue;
      const { files, unique } = await inventory(root, name);
      if (unique)
        plan.retained.push({
          path: `${base}/${name}`,
          reason: `${unique}个独有或尚未发布的文件保留原位`,
        });
      if (!files.length) continue;
      plan.actions.push({
        path: `${base}/${name}`,
        kind: "compact",
        bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      });
      if (!options.apply) continue;
      for (const file of files) {
        if (!(await info(root, archive(file))))
          await putFile(
            await path(root, archive(file)),
            await compress(
              await verifiedFile(
                await path(root, `${name}/${file.path}`),
                file,
              ),
            ),
          );
        await archivedBytes(root, file);
      }
      const markerPath = await path(root, `${name}/compacted.json`);
      const old = await readJson<Compacted>(markerPath);
      const merged = new Map(
        [...(old?.files ?? []), ...files].map((file) => [file.path, file]),
      );
      await atomicJson(markerPath, {
        version: 1,
        compactedAt: new Date(now).toISOString(),
        files: [...merged.values()],
      } satisfies Compacted);
      // Remove individually: an interrupted pass retains a complete recovery receipt.
      for (const file of files) {
        await verifiedFile(await path(root, `${name}/${file.path}`), file);
        await rm(await path(root, `${name}/${file.path}`));
      }
    } catch (error) {
      plan.retained.push({
        path: `${base}/${name}`,
        reason: error instanceof Error ? error.message : String(error),
      });
      if (
        options.apply &&
        plan.actions.some((action) => action.path === `${base}/${name}`)
      )
        throw error;
    }
  }
  const publication = await readJson<{
    lock: { commit: string };
    verifiedAt: string;
  }>(await path(root, "last-publication.json"));
  for (const name of [
    "publication-worktree",
    "verified-remote",
    ...(await children(root, "remote-verification").then((id) =>
      id.map((id) => `remote-verification/${id}`),
    )),
  ]) {
    if (!(await info(root, name))) continue;
    try {
      if (
        !publication ||
        !/^[a-f0-9]{40}$/.test(publication.lock?.commit ?? "") ||
        !Number.isFinite(Date.parse(publication.verifiedAt))
      )
        throw new Error("缺少成功发布收据");
      if ((await pinned(root, name)) || (await referenced(root, name)))
        throw new Error("固定保留或活动引用");
      if (!(await info(root, `${name}/.git`))?.isDirectory())
        throw new Error("缓存不是独立受管Git仓库");
      const bytes = await tree(root, name);
      if (
        !options.compact &&
        now - Date.parse(publication.verifiedAt) <
          policy.syncIdleDays * 86400000 &&
        bytes <= policy.syncCacheMaxBytes
      )
        continue;
      const git = async (args: string[]) =>
        (
          await exec(
            "git",
            [
              "-C",
              await path(root, name),
              "-c",
              `core.hooksPath=${await path(root, `${name}/.git/disabled-hooks`)}`,
              ...args,
            ],
            {
              maxBuffer: 1024 * 1024,
              timeout: 30_000,
              env: {
                ...process.env,
                GIT_LFS_SKIP_SMUDGE: "1",
                GIT_TERMINAL_PROMPT: "0",
              },
            },
          )
        ).stdout.trim();
      if ((await git(["rev-parse", "HEAD"])) !== publication.lock.commit)
        throw new Error("缓存含其他提交，保留待审阅");
      if (await git(["rev-list", "--all", "--not", "HEAD"]))
        throw new Error("缓存含HEAD之外的提交");
      if (await git(["ls-files", "--others", "--exclude-standard"]))
        throw new Error("缓存含未跟踪文件");
      await git(["diff", "--quiet"]);
      await git(["diff", "--cached", "--quiet"]);
      // Keep the independent verification receipt; this cache will be fetched afresh.
      plan.actions.push({ path: `${base}/${name}`, kind: "cache", bytes });
      if (options.apply) {
        await writeJson(
          await path(
            root,
            `storage-receipts/${name.replaceAll("/", "-")}.json`,
          ),
          { removedAt: new Date(now).toISOString(), publication, bytes },
        );
        await rm(await path(root, name), { recursive: true });
      }
    } catch (error) {
      plan.retained.push({
        path: `${base}/${name}`,
        reason: error instanceof Error ? error.message : String(error),
      });
      if (
        options.apply &&
        plan.actions.some((action) => action.path === `${base}/${name}`)
      )
        throw error;
    }
  }
  return plan;
}
export async function maintainSyncStorage(
  options: { apply?: boolean; compact?: boolean; restore?: string } = {},
) {
  const release =
    options.apply || options.restore
      ? await acquireLock("data-sync", 0)
      : async () => {};
  try {
    if (options.restore)
      return { restoredFiles: await restoreSyncPayload(options.restore) };
    const result = await cleanSyncStorage(options);
    if (options.apply)
      await writeJson(
        await path(process.cwd(), "storage-receipts/latest.json"),
        { finishedAt: new Date().toISOString(), ...result },
      );
    return result;
  } finally {
    await release();
  }
}
