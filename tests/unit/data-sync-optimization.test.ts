import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { hydrateSnapshotObjects } from "@/development/data-sync/git";
import {
  restoreDatabase,
  migrationDigest,
  collectDatabase,
} from "@/development/data-sync/database";
import { canReuseDatabase } from "@/development/data-sync/restore";
import {
  sha256,
  canonical,
  digest,
  type SnapshotManifest,
} from "@/development/data-sync/protocol";
import { tables, schemaDigest } from "@/development/data-sync/schema";
import { listMigrations } from "@/server/db/migrations";
import { putFile, chunkPath } from "@/development/data-sync/files";
import type { VerifiedDatabase } from "@/server/environment/contract";
import {
  gitFiles,
  prepareDependencies,
} from "@/development/data-sync/dependencies";

vi.mock("@/development/data-sync/schema", async (original) => ({
  ...(await original<typeof import("@/development/data-sync/schema")>()),
  assertReviewedSchema: async () => {},
}));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function temporary() {
  const base = resolve(".medota2/data-sync/unit-fixtures");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(resolve(base, "optimization-"));
  roots.push(root);
  return root;
}
async function manifest(): Promise<SnapshotManifest> {
  const inventory = tables.map((table) => ({
    name: table.name,
    rows: 0,
    chunks: [],
  }));
  return {
    version: 1,
    exporter: "medota2-snapshot/1",
    codeCommit: "a".repeat(40),
    exportedAt: new Date().toISOString(),
    parents: [],
    schemaDigest,
    migrationsDigest: await migrationDigest(),
    environment: "local-review",
    databaseDigest: digest(inventory),
    tables: inventory,
    objects: [],
    sources: [],
    map: null,
    heads: {},
  };
}

it("hydrates pointers and repairs damaged object bytes from a verified local LFS cache without network requests", async () => {
  const root = await temporary();
  const saved = await manifest();
  for (const [i, value] of [
    "already present",
    "LFS pointer",
    "damaged working file",
  ].entries()) {
    const bytes = Buffer.from(value);
    const file = { sha256: sha256(bytes), bytes: bytes.length };
    saved.objects.push(file);
    await mkdir(resolve(root, "objects"), { recursive: true });
    await writeFile(
      resolve(root, "objects", file.sha256),
      i === 0
        ? bytes
        : i === 1
          ? `version https://git-lfs.github.com/spec/v1\noid sha256:${file.sha256}\nsize ${file.bytes}\n`
          : "broken",
    );
    if (i) {
      const path = resolve(
        root,
        ".git/lfs/objects",
        file.sha256.slice(0, 2),
        file.sha256.slice(2, 4),
      );
      await mkdir(path, { recursive: true });
      await writeFile(resolve(path, file.sha256), bytes);
    }
  }
  const result = await hydrateSnapshotObjects(
    root,
    saved,
    "a".repeat(40),
    true,
  );
  expect(result).toMatchObject({
    localObjects: 1,
    lfsCacheObjects: 2,
    missingObjects: 0,
    lfsFetchCalls: 0,
  });
  for (const file of saved.objects)
    expect(sha256(await readFile(resolve(root, "objects", file.sha256)))).toBe(
      file.sha256,
    );
});

it("restores more than one batch with exact values and rolls back a failed batch", async () => {
  const root = await temporary();
  const saved = await manifest();
  const table = tables.find((table) => table.name === "hero_roles")!;
  const rows = Array.from({ length: 501 }, (_, i) =>
    Object.fromEntries(
      table.columns.map((column) => [
        column.name,
        column.nullable === "YES" ? null : `${column.name}-${i}-中文`,
      ]),
    ),
  );
  const bytes = Buffer.from(rows.map((row) => canonical(row) + "\n").join(""));
  const file = { sha256: sha256(bytes), bytes: bytes.length };
  await putFile(chunkPath(root, file.sha256), bytes);
  Object.assign(
    saved.tables.find((item) => item.name === table.name)!,
    { rows: rows.length, chunks: [file] },
  );
  const migrations = (await listMigrations()).map(({ id, sha256 }) => ({
    id,
    sha256,
  }));
  const inserts: unknown[][] = [];
  let fail = false;
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("SELECT migration_id")) return { rows: migrations };
    if (sql.startsWith('INSERT INTO public."hero_roles"')) {
      if (fail) throw new Error("batch failed");
      inserts.push(values!);
    }
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const db = {
    connect: async () => ({ query, release }),
  } as unknown as VerifiedDatabase<"restore">;
  await restoreDatabase(db, saved, root);
  expect(inserts).toHaveLength(2);
  expect(inserts.flat()).toEqual(
    rows.flatMap((row) => table.columns.map((column) => row[column.name])),
  );
  expect(query).toHaveBeenCalledWith("COMMIT");
  fail = true;
  query.mockClear();
  await expect(restoreDatabase(db, saved, root)).rejects.toThrow(
    "batch failed",
  );
  expect(query).toHaveBeenCalledWith("ROLLBACK");
  expect(query).not.toHaveBeenCalledWith("COMMIT");
  expect(release).toHaveBeenCalledTimes(2);
});

it("reuses a matching live database for resource changes and rebuilds on database or environment changes", async () => {
  const target = await manifest();
  const current = {
    databaseDigest: target.databaseDigest,
    identity: { environment: "local-review" },
  } as Parameters<typeof canReuseDatabase>[1];
  const active = { lease: { environment: "local-review" } } as Parameters<
    typeof canReuseDatabase
  >[2];
  expect(canReuseDatabase(target, current, active)).toBe(true);
  expect(
    canReuseDatabase(
      { ...target, databaseDigest: "f".repeat(64) },
      current,
      active,
    ),
  ).toBe(false);
  expect(
    canReuseDatabase(
      { ...target, environment: "development" },
      current,
      active,
    ),
  ).toBe(false);
  expect(canReuseDatabase(target, current, null)).toBe(false);
});

it("inspects actual asset hashes without transferring payloads and detects a mismatching stored checksum", async () => {
  const table = tables.find((table) => table.name === "asset_blobs")!;
  const hash = sha256(Buffer.from("image"));
  const row = Object.fromEntries(
    table.columns.map((column) => [
      column.name,
      column.nullable === "YES" ? null : "fixture",
    ]),
  );
  Object.assign(row, { content: hash, content_sha256: hash, byte_size: "5" });
  const migrations = (await listMigrations()).map(({ id, sha256 }) => ({
    id,
    sha256,
  }));
  let corrupted = false;
  const reader = {
    query: async (sql: string, values?: unknown[]) => {
      if (sql.includes("SELECT migration_id")) return { rows: migrations };
      if (sql.includes("WHERE status NOT IN")) return { rows: [{ n: 0 }] };
      if (sql.includes('FROM public."asset_blobs"') && values?.[0] === 0)
        return {
          rows: [
            {
              ...row,
              content: corrupted ? "f".repeat(64) : hash,
              actual_byte_size: "5",
            },
          ],
        };
      return { rows: [] };
    },
  } as Parameters<typeof collectDatabase>[0];
  const result = await collectDatabase(reader);
  const expected = Buffer.from(
    canonical({ ...row, content: `sha256:${hash}` }) + "\n",
  );
  expect(
    result.tables.find((table) => table.name === "asset_blobs")!.chunks,
  ).toEqual([{ sha256: sha256(expected), bytes: expected.length }]);
  corrupted = true;
  await expect(collectDatabase(reader)).rejects.toThrow(
    "asset checksum mismatch",
  );
});

it("reads pinned Git files together without changing binary or UTF-8 content, and rejects a missing source", async () => {
  const root = await temporary();
  const execute = promisify(execFile);
  const git = (args: string[]) =>
    execute("git", [
      "-C",
      root,
      "-c",
      `core.hooksPath=${resolve(root, "disabled-hooks")}`,
      "-c",
      "core.autocrlf=false",
      ...args,
    ]);
  await git(["init"]);
  const files = {
    "first.bin": Buffer.from([0, 10, 255, 13]),
    "second.txt": Buffer.from("中文\nline two\n"),
  };
  await writeFile(resolve(root, ".gitattributes"), "* -text\n");
  for (const [path, bytes] of Object.entries(files))
    await writeFile(resolve(root, path), bytes);
  await git(["add", "--all"]);
  await git([
    "-c",
    "user.name=Snapshot fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Pinned source fixture",
  ]);
  const commit = (await git(["rev-parse", "HEAD"])).stdout.trim();
  const result = await gitFiles(root, commit, Object.keys(files));
  for (const [path, bytes] of Object.entries(files))
    expect(result.get(path)).toEqual(bytes);
  await expect(
    gitFiles(root, commit, ["first.bin", "missing.txt"]),
  ).rejects.toThrow("missing or not a blob");
});

it("expands a managed sparse source for newly required item files without overwriting corrupted existing bytes", async () => {
  const root = await temporary();
  const execute = promisify(execFile);
  const git = (where: string, args: string[]) =>
    execute("git", [
      "-C",
      where,
      "-c",
      `core.hooksPath=${resolve(root, "disabled-hooks")}`,
      ...args,
    ]);
  await git(root, ["init"]);
  await mkdir(resolve(root, "scripts/npc"), { recursive: true });
  const files = {
    "steam.inf": Buffer.from(root),
    "scripts/npc/items.txt": Buffer.from('"DOTAAbilities" { "item_blink" {} }'),
  };
  for (const [path, bytes] of Object.entries(files))
    await writeFile(resolve(root, path), bytes);
  await git(root, ["add", "."]);
  await git(root, [
    "-c",
    "user.name=Snapshot fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "Sparse item fixture",
  ]);
  const commit = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  const cache = resolve(".medota2/data-sync/sources", commit);
  roots.push(cache);
  await execute("git", ["clone", "--no-checkout", root, cache]);
  await git(cache, ["sparse-checkout", "init", "--no-cone"]);
  await git(cache, ["sparse-checkout", "set", "/steam.inf"]);
  await git(cache, ["checkout", "--detach", commit]);
  await expect(
    readFile(resolve(cache, "scripts/npc/items.txt")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  const saved = await manifest();
  saved.sources = [
    {
      repository: "spirit-bear-productions/dota_vpk_updates",
      url: "https://github.com/spirit-bear-productions/dota_vpk_updates.git",
      commit,
      files: Object.entries(files).map(([path, bytes]) => ({
        path,
        sha256: sha256(bytes),
        bytes: bytes.length,
      })),
    },
  ];
  await prepareDependencies(saved, root, true);
  expect(await readFile(resolve(cache, "scripts/npc/items.txt"))).toEqual(
    files["scripts/npc/items.txt"],
  );
  await writeFile(resolve(cache, "scripts/npc/items.txt"), "corrupted");
  await expect(prepareDependencies(saved, root, true)).rejects.toThrow();
  expect(await readFile(resolve(cache, "scripts/npc/items.txt"), "utf8")).toBe(
    "corrupted",
  );
});
