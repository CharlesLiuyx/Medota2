import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import {
  configureCatalogSourceWorktree,
  prepareCatalogSourceWorktree,
} from "@/importers/catalog-source-lock";
import { describe, expect, it, vi } from "vitest";
import type { CatalogSourceLock } from "@/importers/catalog-source-lock";
import { verifySnapshotAgainstLock } from "@/importers/catalog-source-lock";
import {
  CATALOG_SELECTOR_VERSION,
  VPK_SOURCE_REPOSITORY,
} from "@/importers/dota-vpk/constants";
import { sha256 } from "@/lib/hash";

const files = [
  { path: "b.txt", sha256: "b".repeat(64), sizeBytes: 2 },
  { path: "a.txt", sha256: "a".repeat(64), sizeBytes: 1 },
];
const manifest = [...files]
  .sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  )
  .map((file) => `${file.path}\t${file.sha256}\t${file.sizeBytes}\n`)
  .join("");

const lock: CatalogSourceLock = {
  version: 1,
  sourceRepository: VPK_SOURCE_REPOSITORY,
  remoteUrl: "https://example.test/source.git",
  commit: "1".repeat(40),
  selectorVersion: CATALOG_SELECTOR_VERSION,
  selectorManifestSha256: "2".repeat(64),
  manifestSha256: sha256(Buffer.from(manifest)),
  clientVersion: "6918",
  sourceRevision: "10949923",
  createdAt: "2026-08-31T00:00:00.000Z",
  files,
};

describe("catalog source lock", () => {
  it("accepts the exact snapshot independently of file iteration order", () => {
    expect(() =>
      verifySnapshotAgainstLock(lock, {
        commit: lock.commit,
        manifestSha256: lock.manifestSha256,
        files: [...lock.files].reverse(),
      }),
    ).not.toThrow();
  });

  it("rejects a blob checksum mismatch even when commit and manifest are claimed", () => {
    expect(() =>
      verifySnapshotAgainstLock(lock, {
        commit: lock.commit,
        manifestSha256: lock.manifestSha256,
        files: lock.files.map((file, index) =>
          index === 0 ? { ...file, sha256: "f".repeat(64) } : file,
        ),
      }),
    ).toThrow("Source file list or blob checksums differ from the lock");
  });
});

it("compacts a real Git worktree without losing pinned objects or local edits", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "medota2-sparse-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  try {
    git("init");
    const files = {
      "steam.inf": "version",
      "scripts/npc/items.txt": "items",
      "scripts/change_log.txt": "patch",
      "resource/localization/abilities_english.txt": "English",
      "resource/localization/abilities_schinese.txt": "中文",
      "resource/localization/abilities_french.txt": "French",
      "scripts/tournaments/large.txt": "unneeded",
    };
    for (const [path, value] of Object.entries(files)) {
      await mkdir(dirname(resolve(root, path)), { recursive: true });
      await writeFile(resolve(root, path), value);
    }
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "-m",
      "fixture",
    );
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "tip",
    );
    const commit = git("rev-parse", "HEAD");
    vi.stubEnv("DOTA_VPK_REMOTE_URL", pathToFileURL(root).href);
    vi.stubEnv("DOTA_VPK_MIRROR_PATH", resolve(root, "mirror.git"));
    vi.stubEnv("DOTA_VPK_WORKTREE_ROOT", resolve(root, "managed"));
    vi.stubEnv("MEDOTA2_NETWORK_POLICY", "normal");
    const prepared = await prepareCatalogSourceWorktree({ ...lock, commit });
    expect(await readFile(resolve(prepared, "steam.inf"), "utf8")).toBe(
      "version",
    );
    expect(
      git(
        "--git-dir",
        resolve(root, "mirror.git"),
        "rev-parse",
        "--is-shallow-repository",
      ),
    ).toBe("true");
    expect(
      git(
        "--git-dir",
        resolve(root, "mirror.git"),
        "rev-list",
        "--count",
        "--all",
      ),
    ).toBe("1");
    vi.stubEnv("MEDOTA2_NETWORK_POLICY", "loopback-only");
    expect(await prepareCatalogSourceWorktree({ ...lock, commit })).toBe(
      prepared,
    );
    const tree = resolve(root, "checkout");
    git("worktree", "add", "--detach", "--no-checkout", tree, commit);
    await configureCatalogSourceWorktree(tree, commit);
    expect(await readFile(resolve(tree, "scripts/npc/items.txt"), "utf8")).toBe(
      "items",
    );
    await expect(
      access(resolve(tree, "scripts/tournaments/large.txt")),
    ).rejects.toThrow();
    expect(git("show", `${commit}:scripts/tournaments/large.txt`)).toBe(
      "unneeded",
    );
    await configureCatalogSourceWorktree(tree, commit);
    await writeFile(resolve(tree, "steam.inf"), "local edit");
    await expect(configureCatalogSourceWorktree(tree, commit)).rejects.toThrow(
      "local changes",
    );
    expect(await readFile(resolve(tree, "steam.inf"), "utf8")).toBe(
      "local edit",
    );
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
