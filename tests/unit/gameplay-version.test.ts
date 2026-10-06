import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
const query = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("@/config/env", () => ({ loadLocalEnv: vi.fn() }));
vi.mock("@/server/db/client", () => ({
  getWebDatabase: async () => ({ query }),
}));
import {
  getGameplayVersion,
  parseGameplayVersion,
} from "@/server/services/gameplay-version";
const exec = promisify(execFile);
const steam = "ClientVersion=6918\nVersionDate=Aug 28 2026\n";
const changelog =
  '"change_log.txt" { "change" { "patch_name" "7.41d" "date" "1780599600" } "change" { "patch_name" "7.41f" "date" "1789455600" } "change" { "patch_name" "7.41e" "date" "1785438000" } }';
afterEach(() => vi.unstubAllEnvs());
it("selects the newest patch present before the source build, regardless of entry order", () => {
  expect(parseGameplayVersion(changelog, steam)).toBe("7.41e");
  expect(parseGameplayVersion(changelog, "ClientVersion=6918")).toBeNull();
});
it("uses immutable Git content only when commit and catalog checksum agree", async () => {
  const root = await mkdtemp(join(tmpdir(), "medota-patch-"));
  try {
    const git = (...args: string[]) => exec("git", ["-C", root, ...args]);
    await git("init", "-q");
    await writeFile(join(root, "steam.inf"), steam);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "scripts"));
    await writeFile(join(root, "scripts/change_log.txt"), changelog);
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
    query.mockResolvedValue({ rows: [record] });
    await writeFile(
      join(root, "scripts/change_log.txt"),
      "uncommitted unrelated patch",
    );
    expect(await getGameplayVersion("catalog", commit)).toBe("7.41e");
    query.mockResolvedValue({ rows: [{ ...record, raw_sha256: "wrong" }] });
    expect(await getGameplayVersion("catalog", commit)).toBeNull();
    query.mockResolvedValue({ rows: [record] });
    expect(await getGameplayVersion("catalog", "b".repeat(40))).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
