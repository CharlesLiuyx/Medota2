import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export async function git(
  args: string[],
  cwd = process.cwd(),
  env = process.env,
) {
  return (
    await execute("git", args, {
      cwd,
      env,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 900_000,
      windowsHide: true,
    })
  ).stdout.trim();
}

/** A disposable index includes deletions and untracked files without changing staging. */
export async function candidateTree(cwd = process.cwd()): Promise<string> {
  const root = resolve(cwd, ".medota2/publications/indexes");
  await mkdir(root, { recursive: true });
  const index = resolve(root, randomUUID());
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    await git(["read-tree", "HEAD"], cwd, env);
    await git(["add", "--all"], cwd, env);
    return await git(["write-tree"], cwd, env);
  } finally {
    await rm(index, { force: true });
    await rm(`${index}.lock`, { force: true });
  }
}

export async function assertCandidate(
  tree: string,
  head: string,
  branch: string,
) {
  if (
    (await git(["symbolic-ref", "--short", "HEAD"])) !== branch ||
    (await git(["rev-parse", "HEAD"])) !== head ||
    (await candidateTree()) !== tree
  )
    throw new Error(
      "发布候选已变化。保留当前工作，稳定输入后重新运行；有并行编辑时先使用独立工作区和独立依赖。",
    );
}

function inside(root: string, path: string): boolean {
  const part = relative(root, path);
  return !isAbsolute(part) && part !== ".." && !part.startsWith(`..${sep}`);
}

/** pnpm's package store can be shared; a workspace's writable modules cannot. */
export async function assertLocalDependencies(cwd = process.cwd()) {
  const modules = resolve(cwd, "node_modules");
  if (
    (await lstat(modules)).isSymbolicLink() ||
    (await realpath(modules)) !== modules
  )
    throw new Error(
      "node_modules 必须属于当前工作区，不能链接其他工作区。请在本目录按锁文件安装依赖。",
    );
  const inspect = async (directory: string, scoped = false) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = resolve(directory, entry.name);
      if (!inside(modules, await realpath(path)))
        throw new Error(
          `依赖 ${entry.name} 指向当前 node_modules 之外，请按锁文件恢复独立依赖。`,
        );
      if (!scoped && entry.name.startsWith("@")) await inspect(path, true);
    }
  };
  await inspect(modules);
  const metadata = await readFile(resolve(modules, ".modules.yaml"), "utf8");
  const store = metadata.trimStart().startsWith("{")
    ? (JSON.parse(metadata).virtualStoreDir as string)
    : /^virtualStoreDir:\s*(.+)$/m
        .exec(metadata)?.[1]
        ?.replace(/^["']|["']$/g, "");
  if (!store || !inside(modules, resolve(modules, store)))
    throw new Error(
      "pnpm virtualStoreDir 不属于当前工作区，请按锁文件恢复依赖。",
    );
}

/** Hooks may rewrite only the index; checking the working tree alone cannot detect that. */
export async function assertCommittedTree(tree: string, cwd = process.cwd()) {
  if ((await git(["rev-parse", "HEAD^{tree}"], cwd)) !== tree)
    throw new Error(
      "实际提交内容与已验证候选不同，可能被提交钩子或并行提交改写；未推送。",
    );
}
export function assertPublishedLock(
  expected: object | undefined,
  actual: object | null,
) {
  const entries = (value: object) =>
    JSON.stringify(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
    );
  if (!expected || !actual || entries(expected) !== entries(actual))
    throw new Error("数据锁与刚刚回取核验的快照不一致，未推送。");
}
