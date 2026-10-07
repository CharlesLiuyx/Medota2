import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  candidateTree,
  git,
  assertLocalDependencies,
  assertCommittedTree,
  assertPublishedLock,
} from "@/development/publication/candidate";
import {
  githubRepository,
  selectCIRun,
  waitForCI,
  type CIRun,
} from "@/development/publication/ci";
import {
  createReceipt,
  type PublicationReceipt,
} from "@/development/publication/receipt";
import {
  publishCandidate,
  confirmPublication,
  type PublicationSteps,
} from "@/development/publication/workflow";
import {
  createPlan,
  publicationPlan,
  parseArguments,
  warmRoutesForScopes,
} from "../../scripts/development/check-plan.mjs";

const evidence = vi.hoisted(() => [] as unknown[]);
vi.mock("@/development/runtime", () => ({
  writeJson: async (_path: string, value: unknown) => {
    evidence.push(structuredClone(value));
  },
  readJson: async () => null,
}));
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
  evidence.length = 0;
});
async function temporary() {
  const base = resolve(".medota2/publication-tests");
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(resolve(base, "case-"));
  roots.push(root);
  return root;
}
async function repository() {
  const root = await temporary();
  await git(["init", "-b", "main"], root);
  await git(["config", "user.name", "Publication Test"], root);
  await git(["config", "user.email", "test@example.invalid"], root);
  await writeFile(resolve(root, ".gitignore"), ".medota2/\nnode_modules/\n");
  await writeFile(resolve(root, "tracked.txt"), "original\n");
  await git(["add", "."], root);
  await git(["commit", "-m", "initial"], root);
  return root;
}
describe("publication candidate", () => {
  it("rejects a commit whose index was rewritten while working files still match the candidate", async () => {
    const root = await repository();
    const tree = await candidateTree(root);
    await git(["update-index", "--force-remove", "tracked.txt"], root);
    await git(["commit", "-m", "simulate index-only hook rewrite"], root);
    expect(await candidateTree(root)).toBe(tree);
    await expect(assertCommittedTree(tree, root)).rejects.toThrow(
      "实际提交内容",
    );
  });
  it("binds the final lock to the independently verified publication result", () => {
    expect(() =>
      assertPublishedLock(
        { snapshotId: "a", commit: "b" },
        { commit: "b", snapshotId: "a" },
      ),
    ).not.toThrow();
    expect(() =>
      assertPublishedLock(
        { snapshotId: "a", commit: "b" },
        { snapshotId: "c", commit: "b" },
      ),
    ).toThrow("数据锁");
    expect(() => assertPublishedLock(undefined, { snapshotId: "a" })).toThrow(
      "数据锁",
    );
  });
  it("captures unstaged, staged, new and deleted files without mutating the real index", async () => {
    const root = await repository();
    const initial = await candidateTree(root);
    await writeFile(resolve(root, "tracked.txt"), "staged\n");
    await git(["add", "tracked.txt"], root);
    const index = await git(["write-tree"], root);
    await writeFile(resolve(root, "tracked.txt"), "later working content\n");
    await writeFile(resolve(root, "new file.txt"), "new\n");
    const changed = await candidateTree(root);
    expect(changed).not.toBe(initial);
    expect(await git(["show", `${changed}:tracked.txt`], root)).toBe(
      "later working content",
    );
    expect(await git(["write-tree"], root)).toBe(index);
    await rm(resolve(root, "tracked.txt"));
    expect(await candidateTree(root)).not.toBe(changed);
    expect(await git(["write-tree"], root)).toBe(index);
  });
  it("blocks cross-workspace modules and package links, accepts the local pnpm layout", async () => {
    const root = await temporary();
    const other = await temporary();
    await mkdir(resolve(other, "modules"));
    await symlink(
      resolve(other, "modules"),
      resolve(root, "node_modules"),
      "junction",
    );
    await expect(assertLocalDependencies(root)).rejects.toThrow("node_modules");
    await rm(resolve(root, "node_modules"));
    await mkdir(resolve(root, "node_modules/.pnpm"), { recursive: true });
    await writeFile(
      resolve(root, "node_modules/.modules.yaml"),
      "virtualStoreDir: .pnpm\n",
    );
    await expect(assertLocalDependencies(root)).resolves.toBeUndefined();
    await symlink(
      resolve(other, "modules"),
      resolve(root, "node_modules/next"),
      "junction",
    );
    await expect(assertLocalDependencies(root)).rejects.toThrow("next");
    await rm(resolve(root, "node_modules/next"));
    await writeFile(
      resolve(root, "node_modules/.modules.yaml"),
      JSON.stringify({ virtualStoreDir: ".pnpm" }),
    );
    await expect(assertLocalDependencies(root)).resolves.toBeUndefined();
    await writeFile(
      resolve(root, "node_modules/.modules.yaml"),
      `virtualStoreDir: ${other}\n`,
    );
    await expect(assertLocalDependencies(root)).rejects.toThrow(
      "virtualStoreDir",
    );
  });
});
function receipt() {
  return createReceipt({
    branch: "main",
    remote: "origin",
    remoteRef: "refs/heads/main",
    repository: "owner/repo",
    base: "base",
    tree: "candidate",
  });
}
function steps(): PublicationSteps {
  return {
    preflight: vi.fn(async () => {}),
    commit: vi.fn(async () => "code"),
    prepareData: vi.fn(async () => "snapshot"),
    check: vi.fn(async () => {}),
    assertCandidate: vi.fn(async () => {}),
    publishData: vi.fn(async () => {}),
    finalize: vi.fn(async () => "final"),
    assertRemote: vi.fn(async () => {}),
    push: vi.fn(async () => {}),
    remoteContains: vi.fn(async () => true),
    confirmCI: vi.fn(
      async () => "https://github.com/owner/repo/actions/runs/1",
    ),
  };
}
describe("publication failure boundaries", () => {
  it.each([
    "preflight",
    "commit",
    "prepareData",
    "check",
    "assertCandidate",
    "assertRemote",
    "publishData",
    "finalize",
  ] as const)(
    "does not push when %s fails and records the failing phase",
    async (name) => {
      const work = steps();
      const saved = receipt();
      vi.mocked(work[name]).mockRejectedValue(new Error("injected failure"));
      await expect(publishCandidate(saved, work)).rejects.toThrow(
        "injected failure",
      );
      expect(work.push).not.toHaveBeenCalled();
      expect(work.confirmCI).not.toHaveBeenCalled();
      expect(saved.status).toBe("failed");
      expect(saved.stages.at(-1)?.status).toBe("failed");
      if (["check", "assertCandidate"].includes(name))
        expect(work.publishData).not.toHaveBeenCalled();
    },
  );
  it("persists the exact commit before push, and recovers an uncertain push by reading the remote", async () => {
    const saved = receipt();
    const work = steps();
    vi.mocked(work.push).mockImplementation(async () => {
      expect(
        evidence.some(
          (value) => (value as PublicationReceipt).finalCommit === "final",
        ),
      ).toBe(true);
      throw new Error("connection lost after server accepted push");
    });
    await publishCandidate(saved, work);
    expect(saved.status).toBe("passed");
    expect(work.push).toHaveBeenCalledTimes(1);
    expect(work.publishData).toHaveBeenCalledWith("snapshot");
  });
  it("does not treat an uncertain rejected push as success", async () => {
    const saved = receipt();
    const work = steps();
    vi.mocked(work.push).mockRejectedValue(new Error("rejected"));
    vi.mocked(work.remoteContains).mockResolvedValue(false);
    await expect(publishCandidate(saved, work)).rejects.toThrow("rejected");
    expect(work.confirmCI).not.toHaveBeenCalled();
  });
  it("resumes CI without committing, checking or republishing code/data", async () => {
    const saved = receipt();
    const work = steps();
    vi.mocked(work.confirmCI).mockRejectedValueOnce(
      new Error("CI interrupted"),
    );
    await expect(publishCandidate(saved, work)).rejects.toThrow(
      "CI interrupted",
    );
    expect(saved.finalCommit).toBe("final");
    await confirmPublication(saved, work);
    expect(saved.status).toBe("passed");
    for (const name of ["commit", "check", "publishData", "push"] as const)
      expect(work[name]).toHaveBeenCalledTimes(1);
  });
  it("rejects stale remote evidence on resume", async () => {
    const saved = { ...receipt(), finalCommit: "old" };
    const work = steps();
    vi.mocked(work.remoteContains).mockResolvedValue(false);
    await expect(confirmPublication(saved, work)).rejects.toThrow("远端");
    expect(work.confirmCI).not.toHaveBeenCalled();
  });
});
const ci = (changes: Partial<CIRun> = {}): CIRun => ({
  databaseId: 1,
  headSha: "target",
  event: "push",
  status: "completed",
  conclusion: "success",
  url: "https://github.com/owner/repo/actions/runs/1",
  ...changes,
});
describe("exact CI and fixture planning", () => {
  it("warms selected journey modules and retains full warmup for unknown or cross-module scopes", () => {
    expect(warmRoutesForScopes(["heroes", "tooltips"])).toContain(
      "heroes/antimage",
    );
    expect(warmRoutesForScopes(["heroes", "tooltips"])).not.toContain("map");
    expect(warmRoutesForScopes(["locale"])).toContain("map");
    expect(warmRoutesForScopes(["future-flow"])).toContain("map");
    expect(warmRoutesForScopes(["attributes"])).toContain("items/item_blink");
  });
  it("accepts only push runs for the candidate, prioritizing the newest run", () => {
    expect(
      selectCIRun(
        [
          ci({ databaseId: 5, headSha: "other" }),
          ci({ databaseId: 6, event: "pull_request" }),
          ci(),
          ci({ databaseId: 3, conclusion: "failure" }),
        ],
        "target",
      )?.databaseId,
    ).toBe(3);
    expect(githubRepository("git@github.com:owner/repo.git")).toBe(
      "owner/repo",
    );
    expect(() =>
      githubRepository("https://secret@github.com/owner/repo.git"),
    ).toThrow();
  });
  it("waits through registration delay and in-progress, then confirms success", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([ci({ status: "in_progress", conclusion: null })])
      .mockResolvedValue([ci()]);
    await expect(
      waitForCI("owner/repo", "target", { query, sleep: async () => {} }),
    ).resolves.toMatchObject({ conclusion: "success" });
    expect(query).toHaveBeenCalledTimes(3);
  });
  it.each(["failure", "cancelled", "skipped"])(
    "never reports %s CI as passed",
    async (conclusion) => {
      await expect(
        waitForCI("owner/repo", "target", {
          query: async () => [ci({ conclusion })],
        }),
      ).rejects.toThrow(conclusion);
    },
  );
  it("times out without silently accepting a missing run", async () => {
    await expect(
      waitForCI("owner/repo", "target", {
        timeoutMs: 0,
        query: async () => [],
      }),
    ).rejects.toThrow("超时");
  });
  it("adds only selected fixture journeys before real journeys; docs and CI stay unduplicated", () => {
    const plan = createPlan(["src/components/hero-card.tsx"]);
    const enhanced = publicationPlan(plan);
    const index = enhanced.tasks.findIndex(
      (task) => task.id === "journeys-fixture",
    );
    expect(index).toBeGreaterThanOrEqual(0);
    expect(enhanced.tasks[index].args).toContain("--fixture");
    expect(enhanced.tasks[index + 1].id).toBe("journeys");
    expect(publicationPlan(plan, true)).toEqual(plan);
    expect(publicationPlan(createPlan(["README.md"])).browser).toBe(false);
    expect(parseArguments(["--publication"]).publication).toBe(true);
  });
});
