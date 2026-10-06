import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ readFile: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/config/env", () => ({ loadLocalEnv: vi.fn() }));
vi.mock("@/server/db/client", () => ({
  getWebDatabase: async () => ({ query: mocks.query }),
}));
import { getGameLocalization } from "@/server/services/game-localization";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("snapshot-bound game text", () => {
  it("recovers differently cased names only after verifying the full source hash", async () => {
    const data = Buffer.from(
      '"lang" { "Tokens" { "DOTA_Tooltip_Ability_broodmother_spin_web" "织网" } }',
    );
    const commit = "a".repeat(40);
    mocks.query.mockResolvedValue({
      rows: [
        {
          raw_sha256: createHash("sha256").update(data).digest("hex"),
          source_commit: commit,
        },
      ],
    });
    mocks.readFile.mockResolvedValue(data);
    vi.stubEnv("DOTA_VPK_WORKTREE_ROOT", "/verified-game-sources");
    expect(
      (await getGameLocalization("catalog", commit, "zh-CN"))
        .dota_tooltip_ability_broodmother_spin_web,
    ).toBe("织网");
    expect(mocks.readFile).toHaveBeenCalledWith(
      resolve(
        `/verified-game-sources/${commit}/resource/localization/abilities_schinese.txt`,
      ),
    );
    // A changed checkout must not reuse the previously verified parsed cache.
    mocks.readFile.mockResolvedValue(Buffer.from("different version"));
    expect(await getGameLocalization("catalog", commit, "zh-CN")).toEqual({});
    expect(
      await getGameLocalization("catalog", "b".repeat(40), "zh-CN"),
    ).toEqual({});
  });
});
