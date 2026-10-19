import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  cleanSyncStorage,
  restoreSyncPayload,
} from "@/development/data-sync/storage";
import { sha256 } from "@/development/data-sync/protocol";
const exec = promisify(execFile);
const roots: string[] = [];
const id = "a".repeat(64),
  now = Date.parse("2026-10-19T00:00:00Z");
async function workspace() {
  const root = await mkdtemp(resolve(tmpdir(), "sync-storage-"));
  roots.push(root);
  return root;
}
async function file(root: string, path: string, content: string) {
  const full = resolve(root, ".medota2/data-sync", path);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
  return full;
}
async function fixture(
  root: string,
  name = "export",
  content = "original business payload",
) {
  const path = `objects/${sha256(Buffer.from(content))}`;
  await file(root, `${name}/${path}`, content);
  await file(root, `repository/${path}`, content);
  await file(
    root,
    `${name}/snapshots/${id}/manifest.json`,
    JSON.stringify({ exportedAt: "2026-10-01T00:00:00Z" }),
  );
  return path;
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
describe("sync storage lifecycle", () => {
  it("compacts duplicate staging bytes once, preserves provenance and restores offline after repository changes", async () => {
    const root = await workspace(),
      name = `bundles/${id}`;
    const path = await fixture(root);
    await fixture(root, name);
    const preview = await cleanSyncStorage({ root, now });
    expect(preview.actions).toHaveLength(2);
    expect(
      await readFile(
        resolve(root, `.medota2/data-sync/export/${path}`),
        "utf8",
      ),
    ).toBe("original business payload");
    await cleanSyncStorage({ root, now, apply: true });
    await expect(
      access(resolve(root, `.medota2/data-sync/export/${path}`)),
    ).rejects.toThrow();
    expect(
      await readFile(
        resolve(
          root,
          `.medota2/data-sync/export/snapshots/${id}/manifest.json`,
        ),
        "utf8",
      ),
    ).toContain("2026-10-01");
    await rm(resolve(root, ".medota2/data-sync/repository"), {
      recursive: true,
    });
    expect(await restoreSyncPayload("export", root)).toBe(1);
    expect(await restoreSyncPayload(name, root)).toBe(1);
    expect(
      await readFile(
        resolve(root, `.medota2/data-sync/export/${path}`),
        "utf8",
      ),
    ).toBe("original business payload");
    expect(await restoreSyncPayload(name, root)).toBe(0);
    // Restoring an old manifest must protect the newly materialized copy for a full grace period.
    await fixture(root);
    expect(
      (await cleanSyncStorage({ root, now: Date.now(), apply: true })).actions,
    ).toHaveLength(0);
    expect(
      (await cleanSyncStorage({ root, now: Date.now() + 8 * 86400000 })).actions
        .length,
    ).toBeGreaterThan(0);
  });
  it("retains unpublished, corrupted, pinned and actively referenced payloads", async () => {
    for (const condition of ["unpublished", "corrupted", "pinned", "active"]) {
      const root = await workspace(),
        path = await fixture(root);
      if (condition === "unpublished")
        await rm(resolve(root, `.medota2/data-sync/repository/${path}`));
      if (condition === "corrupted")
        await file(root, `repository/${path}`, "damaged");
      if (condition === "pinned") await file(root, "export/.keep", "");
      if (condition === "active")
        await file(
          root,
          "active.json",
          JSON.stringify({
            snapshotManifestPath: resolve(
              root,
              `.medota2/data-sync/export/snapshots/${id}/manifest.json`,
            ),
          }),
        );
      const plan = await cleanSyncStorage({
        root,
        now,
        apply: true,
        compact: true,
      });
      expect(plan.actions).toHaveLength(0);
      expect(plan.retained).toHaveLength(1);
      expect(
        await readFile(
          resolve(root, `.medota2/data-sync/export/${path}`),
          "utf8",
        ),
      ).toBe("original business payload");
    }
  });
  it("honors idle grace and fails safely on damaged archives or linked roots", async () => {
    const root = await workspace(),
      path = await fixture(root);
    await file(
      root,
      `export/snapshots/${id}/manifest.json`,
      JSON.stringify({ exportedAt: new Date(now).toISOString() }),
    );
    expect(
      (await cleanSyncStorage({ root, now, apply: true })).actions,
    ).toHaveLength(0);
    await cleanSyncStorage({ root, now, apply: true, compact: true });
    await file(root, `payload-archive/${path}.gz`, "corrupt");
    await expect(restoreSyncPayload("export", root)).rejects.toThrow();
    await expect(restoreSyncPayload("../candidates", root)).rejects.toThrow(
      "Unsupported",
    );
    await expect(
      access(resolve(root, ".medota2/data-sync/export/compacted.json")),
    ).resolves.toBeUndefined();
    const external = await workspace();
    await rm(resolve(root, ".medota2/data-sync/export"), { recursive: true });
    await symlink(
      external,
      resolve(root, ".medota2/data-sync/export"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(cleanSyncStorage({ root, now, apply: true })).rejects.toThrow(
      "refuses links",
    );
  });
  it("retires only clean, successfully published cache commits, preserving unknown branches and changes", async () => {
    const root = await workspace();
    const repo = resolve(root, ".medota2/data-sync/publication-worktree");
    await file(root, "publication-worktree/proof", "published");
    const git = async (...args: string[]) =>
      (await exec("git", ["-C", repo, ...args])).stdout.trim();
    await git("init");
    await git("config", "user.name", "Storage Test");
    await git("config", "user.email", "storage@example.test");
    await git("add", ".");
    await git("commit", "-m", "published");
    const commit = await git("rev-parse", "HEAD");
    await file(
      root,
      "last-publication.json",
      JSON.stringify({ lock: { commit }, verifiedAt: "2026-10-01T00:00:00Z" }),
    );
    await file(root, "publication-worktree/unpublished", "unique");
    expect(
      (await cleanSyncStorage({ root, now, apply: true })).actions,
    ).toHaveLength(0);
    await git("add", ".");
    await git("commit", "-m", "not published");
    await git("branch", "pending");
    await git("checkout", "--detach", commit);
    expect(
      (await cleanSyncStorage({ root, now, apply: true })).actions,
    ).toHaveLength(0);
    await git("branch", "-D", "pending");
    // The default branch also points at the unpublished commit.
    const branches = (
      await git("for-each-ref", "--format=%(refname:short)", "refs/heads")
    )
      .split("\n")
      .filter(Boolean);
    for (const branch of branches) await git("branch", "-D", branch);
    const plan = await cleanSyncStorage({ root, now, apply: true });
    expect(plan.actions).toHaveLength(1);
    await expect(access(repo)).rejects.toThrow();
    expect(
      await readFile(
        resolve(
          root,
          ".medota2/data-sync/storage-receipts/publication-worktree.json",
        ),
        "utf8",
      ),
    ).toContain(commit);
  });
});
