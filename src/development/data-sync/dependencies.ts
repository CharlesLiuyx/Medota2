import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/config/env";
import { syncRoot, assertOwnedPath } from "@/config/data-sync-state";
import { collectMaps, inspectMaps, mapDigest, restoreMaps } from "./maps";
import {
  assertRelativeFile,
  sha256,
  type TextRow,
  type SnapshotManifest,
} from "./protocol";
import { verifiedFile } from "./files";
const exec = promisify(execFile);
const runtimePaths = [
  "steam.inf",
  "scripts/change_log.txt",
  "scripts/npc/npc_units.txt",
  "resource/localization/abilities_english.txt",
  "resource/localization/abilities_schinese.txt",
];

export async function gitFiles(
  root: string,
  commit: string,
  paths: string[],
): Promise<Map<string, Buffer>> {
  paths.forEach(assertRelativeFile);
  const stdout = await new Promise<Buffer>((accept, reject) => {
    const child = execFile(
      "git",
      ["-C", root, "cat-file", "--batch"],
      {
        encoding: "buffer",
        maxBuffer: 128 * 1024 * 1024,
        timeout: 30_000,
        windowsHide: true,
      },
      (error, output) => (error ? reject(error) : accept(output)),
    );
    child.stdin!.end(
      paths.map((path) => `${commit}:${path}`).join("\n") + "\n",
    );
  });
  const files = new Map<string, Buffer>();
  let offset = 0;
  for (const path of paths) {
    const end = stdout.indexOf(10, offset);
    if (end < 0) throw new Error("Incomplete source Git batch response.");
    const header = stdout.subarray(offset, end).toString("utf8");
    const match = /^[a-f0-9]{40} blob (\d+)$/.exec(header);
    if (!match)
      throw new Error(`Pinned source file is missing or not a blob: ${path}`);
    const size = Number(match[1]);
    offset = end + 1;
    if (offset + size >= stdout.length || stdout[offset + size] !== 10)
      throw new Error("Incomplete source Git blob.");
    files.set(path, stdout.subarray(offset, offset + size));
    offset += size + 1;
  }
  if (offset !== stdout.length)
    throw new Error("Unexpected source Git batch output.");
  return files;
}

export async function gitBytes(
  root: string,
  commit: string,
  path: string,
): Promise<Buffer> {
  assertRelativeFile(path);
  const { stdout } = await exec(
    "git",
    ["-C", root, "show", `${commit}:${path}`],
    { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, timeout: 30_000 },
  );
  return stdout;
}
function validateSourceUrl(url: string): void {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    ![
      "/spirit-bear-productions/dota_vpk_updates.git",
      "/spirit-bear-productions/dota_vpk_updates",
    ].includes(parsed.pathname) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      "Source manifest must use the reviewed dota_vpk_updates HTTPS remote.",
    );
}
export async function findSourceRoot(commit: string): Promise<string> {
  loadLocalEnv();
  const candidates = [
    resolve(syncRoot(), "sources", commit),
    resolve(
      process.env.DOTA_VPK_WORKTREE_ROOT || ".medota2/cache/worktrees",
      commit,
    ),
    process.env.DOTA_VPK_UPDATES_PATH,
  ].filter((path): path is string => Boolean(path));
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      await exec("git", ["-C", path, "cat-file", "-e", `${commit}^{commit}`], {
        timeout: 5000,
      });
      return resolve(path);
    } catch {
      /* Try the next configured source, never change its checkout. */
    }
  }
  throw new Error(
    `Pinned source ${commit} is unavailable. Configure DOTA_VPK_UPDATES_PATH or fetch the snapshot dependencies.`,
  );
}

export async function collectSources(
  rows: TextRow[],
  files: TextRow[],
): Promise<SnapshotManifest["sources"]> {
  const result: SnapshotManifest["sources"] = [];
  for (const row of rows) {
    if (!row.source_commit || !row.source_remote_url || !row.source_repository)
      throw new Error("Incomplete source provenance.");
    validateSourceUrl(row.source_remote_url);
    const root = await findSourceRoot(row.source_commit);
    const expected = files.filter((file) => file.source_snapshot_id === row.id);
    const paths = [
      ...new Set([
        ...expected.map((file) => file.source_path!),
        ...runtimePaths,
      ]),
    ].sort();
    const source: SnapshotManifest["sources"][number] = {
      repository: row.source_repository,
      url: row.source_remote_url,
      commit: row.source_commit,
      files: [],
    };
    const contents = await gitFiles(root, row.source_commit, paths);
    for (const path of paths) {
      const bytes = contents.get(path)!;
      const hash = sha256(bytes);
      const saved = expected.find((file) => file.source_path === path);
      if (
        saved &&
        (saved.raw_sha256 !== hash || saved.size_bytes !== String(bytes.length))
      )
        throw new Error(
          `Source checksum mismatch at ${row.source_commit}:${path}`,
        );
      source.files.push({ path, sha256: hash, bytes: bytes.length });
    }
    result.push(source);
  }
  return result.sort((a, b) =>
    `${a.url}:${a.commit}`.localeCompare(`${b.url}:${b.commit}`),
  );
}

export const collectMap = collectMaps;

export async function prepareDependencies(
  manifest: SnapshotManifest,
  repository: string,
  offline = false,
): Promise<{
  sourceRoot: string;
  mapRoot: string | null;
  mapCollectionPath: string | null;
}> {
  const sourceRoot = resolve(syncRoot(), "sources");
  await mkdir(sourceRoot, { recursive: true });
  for (const source of manifest.sources) {
    validateSourceUrl(source.url);
    for (const file of source.files) assertRelativeFile(file.path);
    const root = assertOwnedPath(resolve(sourceRoot, source.commit));
    const head = existsSync(resolve(root, ".git"))
      ? await exec("git", ["-C", root, "rev-parse", "--verify", "HEAD"])
          .then((result) => result.stdout.trim())
          .catch(() => null)
      : null;
    if (!head) {
      let from: string;
      try {
        from = await findSourceRoot(source.commit);
      } catch {
        if (offline)
          throw new Error(`Offline source unavailable: ${source.commit}`);
        from = source.url;
      }
      await mkdir(root, { recursive: true });
      if (!existsSync(resolve(root, ".git"))) await exec("git", ["init", root]);
      await exec(
        "git",
        [
          "-C",
          root,
          "-c",
          "protocol.file.allow=always",
          "fetch",
          "--no-tags",
          "--depth=1",
          "--filter=blob:none",
          from,
          source.commit,
        ],
        { maxBuffer: 8 * 1024 * 1024, timeout: 300_000 },
      );
      await exec("git", ["-C", root, "sparse-checkout", "init", "--no-cone"]);
      // Paths are validated literal source paths. Avoid line ending conversion.
      await writeFile(
        resolve(root, ".git/info/sparse-checkout"),
        source.files.map((file) => `/${file.path}`).join("\n") + "\n",
      );
      await exec(
        "git",
        [
          "-C",
          root,
          "-c",
          "core.autocrlf=false",
          "checkout",
          "--detach",
          source.commit,
        ],
        { timeout: 300_000, maxBuffer: 8 * 1024 * 1024 },
      );
    }
    const actual = (
      await exec("git", ["-C", root, "rev-parse", "HEAD"])
    ).stdout.trim();
    if (actual !== source.commit)
      throw new Error("Managed source checkout points to another commit.");
    const contents = await gitFiles(
      root,
      source.commit,
      source.files.map((file) => file.path),
    );
    for (const file of source.files) {
      const bytes = contents.get(file.path)!;
      if (sha256(bytes) !== file.sha256 || bytes.length !== file.bytes)
        throw new Error(`Pinned source changed: ${file.path}`);
      // Supplemental localization reads the working file; validate it too.
      await verifiedFile(assertOwnedPath(resolve(root, file.path), root), file);
    }
  }
  return { sourceRoot, ...(await restoreMaps(manifest.map, repository)) };
}

export async function verifyLiveDependencies(
  manifest: SnapshotManifest,
): Promise<string[]> {
  const problems: string[] = [];
  for (const source of manifest.sources) {
    try {
      const root = await findSourceRoot(source.commit);
      const contents = await gitFiles(
        root,
        source.commit,
        source.files.map((file) => file.path),
      );
      for (const file of source.files) {
        const data = contents.get(file.path)!;
        if (sha256(data) !== file.sha256 || data.length !== file.bytes)
          throw new Error(`Source mismatch: ${file.path}`);
        if (file.path.startsWith("resource/localization/abilities_"))
          await verifiedFile(resolve(root, file.path), file);
      }
    } catch (error) {
      problems.push(
        error instanceof Error ? error.message : "Source verification failed.",
      );
    }
  }
  try {
    if (mapDigest(await inspectMaps()) !== mapDigest(manifest.map))
      problems.push(
        "Current map collection differs from the target snapshot. Run pnpm data:publish before pushing code.",
      );
  } catch (error) {
    problems.push(
      error instanceof Error ? error.message : "Map verification failed.",
    );
  }
  return problems;
}
