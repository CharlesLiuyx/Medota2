import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/config/env", () => ({ loadLocalEnv: vi.fn() }));
vi.mock("@/server/repositories/heroes", () => ({
  getActiveCatalogMeta: vi.fn(),
}));
vi.mock("@/server/db/client", () => ({
  getWebDatabase: async () => ({ query }),
}));
import { readUnitSnapshot } from "@/server/repositories/units";
import type { ActiveDatasetMeta } from "@/server/repositories/heroes";
const exec = promisify(execFile);
afterEach(() => vi.unstubAllEnvs());
it("reads the pinned Git objects and rejects commit/checksum conflicts, including after caching", async () => {
  const root = await mkdtemp(join(tmpdir(), "medota-units-"));
  try {
    const git = (...args: string[]) => exec("git", ["-C", root, ...args]);
    await git("init", "-q");
    await mkdir(join(root, "scripts/npc"), { recursive: true });
    await mkdir(join(root, "resource/localization"), { recursive: true });
    const steam = "ClientVersion=1\n";
    const path = join(root, "scripts/npc/npc_units.txt");
    await writeFile(join(root, "steam.inf"), steam);
    await writeFile(
      path,
      '"DOTAUnits" { "npc_dota_units_base" { "StatusHealth" "150" } "npc_dota_roshan" { "StatusHealth" "6000" } }',
    );
    for (const lang of ["schinese", "english"])
      await writeFile(
        join(root, `resource/localization/abilities_${lang}.txt`),
        '"lang" { "Tokens" { "npc_dota_roshan" "Roshan" } }',
      );
    await git("add", ".");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-qm",
      "fixture",
    );
    const commit = (await git("rev-parse", "HEAD")).stdout.trim();
    vi.stubEnv("DOTA_VPK_UPDATES_PATH", root);
    vi.stubEnv("DOTA_VPK_WORKTREE_ROOT", join(root, "missing"));
    const record = {
      source_commit: commit,
      raw_sha256: createHash("sha256").update(steam).digest("hex"),
    };
    const meta = {
      datasetVersionId: "units-test",
      sourceCommit: commit,
      sourceRepository: "fixture",
      clientVersion: "1",
    } as ActiveDatasetMeta;
    query.mockResolvedValue({ rows: [record] });
    await writeFile(path, "uncommitted incompatible data");
    expect(
      (await readUnitSnapshot(meta))?.units.find(
        (u) => u.internalName === "npc_dota_roshan",
      )?.stats.StatusHealth,
    ).toBe("6000");
    query.mockResolvedValue({ rows: [{ ...record, raw_sha256: "wrong" }] });
    expect(await readUnitSnapshot(meta)).toBeNull();
    query.mockResolvedValue({
      rows: [{ ...record, source_commit: "b".repeat(40) }],
    });
    expect(await readUnitSnapshot(meta)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
