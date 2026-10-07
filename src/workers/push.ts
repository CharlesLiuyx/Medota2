import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { loadLocalEnv } from "@/config/env";
import {
  acquireLock,
  fingerprint,
  run,
  writeJson,
} from "@/development/runtime";
import {
  exportCurrent,
  publishData,
  assertPrivateRemote,
} from "@/development/data-sync/publish";
import { configureRepository, readDataLock } from "@/development/data-sync/git";
import { taskProcess } from "@/development/data-sync/tasks";
import {
  candidateTree,
  assertCandidate,
  assertLocalDependencies,
  assertCommittedTree,
  assertPublishedLock,
  git,
} from "@/development/publication/candidate";
import { gh, githubRepository, waitForCI } from "@/development/publication/ci";
import {
  createReceipt,
  readLatestReceipt,
  recentPublications,
  saveReceipt,
} from "@/development/publication/receipt";
import {
  publishCandidate,
  confirmPublication,
} from "@/development/publication/workflow";
import {
  changedFiles,
  createPlan,
  publicationPlan,
} from "../../scripts/development/check-plan.mjs";

async function main() {
  const { values } = parseArgs({
    options: {
      message: { type: "string", short: "m" },
      plan: { type: "boolean" },
      resume: { type: "boolean" },
      status: { type: "boolean" },
    },
  });
  if ([values.plan, values.resume, values.status].filter(Boolean).length > 1)
    throw new Error("--plan、--resume、--status 不能同时使用。");
  if (values.status) {
    console.log(JSON.stringify(await recentPublications(), null, 2));
    return;
  }
  loadLocalEnv();
  const branch = await git(["symbolic-ref", "--short", "HEAD"]);
  const remote = await git([
    "config",
    "--get",
    `branch.${branch}.remote`,
  ]).catch(() => "origin");
  const remoteRef = await git([
    "config",
    "--get",
    `branch.${branch}.merge`,
  ]).catch(() => `refs/heads/${branch}`);
  const pushUrl = await git(["remote", "get-url", "--push", "--all", remote]);
  const repository = githubRepository(pushUrl);
  if (githubRepository(await git(["remote", "get-url", remote])) !== repository)
    throw new Error("读取与推送远端指向不同仓库，无法绑定同一发布基线。");
  if (values.plan) {
    const base = await git(["rev-parse", "@{upstream}"]).catch(() => "HEAD");
    console.log(
      JSON.stringify(
        {
          branch,
          remote,
          remoteRef,
          base,
          remoteFresh: false,
          checks: publicationPlan(
            createPlan(changedFiles(base)),
            Boolean(process.env.CI),
          ),
          stages: [
            "preflight",
            "commit-candidate",
            "prepare-data",
            "checks",
            "publish-data",
            "finalize",
            "push-code",
            "confirm-ci",
          ],
        },
        null,
        2,
      ),
    );
    return;
  }
  const release = await acquireLock("publication");
  try {
    const remoteHead = async () =>
      (await git(["ls-remote", remote, remoteRef])).split(/\s/)[0];
    const remoteContains = async (sha: string) => (await remoteHead()) === sha;
    if (values.resume) {
      const saved = await readLatestReceipt();
      if (
        !saved ||
        saved.version !== 1 ||
        saved.branch !== branch ||
        saved.remote !== remote ||
        saved.remoteRef !== remoteRef ||
        saved.repository !== repository
      )
        throw new Error("没有匹配当前分支与远端的发布收据。");
      await confirmPublication(saved, {
        remoteContains,
        confirmCI: async (sha) => (await waitForCI(repository, sha)).url,
      });
      return;
    }
    // The workflow currently runs on main pushes. Do not upload data for a branch with no CI trigger.
    if (remoteRef !== "refs/heads/main")
      throw new Error(
        "当前verify工作流只监听main推送；请先准备合入main的候选。功能分支CI合入策略需单独配置。",
      );
    await assertLocalDependencies();
    await git(["fetch", "--no-tags", remote, remoteRef]);
    const base = await git(["rev-parse", "FETCH_HEAD"]);
    let head = await git(["rev-parse", "HEAD"]);
    await git(["merge-base", "--is-ancestor", base, head]).catch(() => {
      throw new Error("远端已有未整合提交。先整合，再验证；不会强制推送。");
    });
    const tree = await candidateTree();
    const environmentFiles = [
      ".env",
      ".env.local",
      ".env.development",
      ".env.development.local",
      ".env.test",
      ".env.production",
      ".env.production.local",
    ];
    const environmentKey = await fingerprint(environmentFiles);
    const guard = async (expectedTree = tree, expectedHead = head) => {
      await assertCandidate(expectedTree, expectedHead, branch);
      await assertLocalDependencies();
      if ((await fingerprint(environmentFiles)) !== environmentKey)
        throw new Error("运行配置在发布期间变化，请稳定配置后重新验证。");
    };
    const originalIndex = await git(["write-tree"]);
    const receipt = createReceipt({
      branch,
      remote,
      remoteRef,
      repository,
      base,
      tree,
    });
    const paths = changedFiles(base);
    await writeJson(
      resolve(".medota2/publications", receipt.id, "plan.json"),
      publicationPlan(createPlan(paths), Boolean(process.env.CI)),
    );
    await saveReceipt(receipt);
    const command = async (name: string, args: string[]) =>
      run(
        "pnpm",
        args,
        { ...process.env, pnpm_config_verify_deps_before_run: "error" },
        resolve(".medota2/publications", receipt.id, `${name}.log`),
      );
    let finalTree = tree;
    let publishedLock: Awaited<ReturnType<typeof readDataLock>> = null;
    const withDataLock = async <T>(work: () => Promise<T>): Promise<T> => {
      const unlock = await acquireLock("data-sync");
      try {
        return await work();
      } finally {
        await unlock();
      }
    };
    const assertRemote = async () => {
      if (
        (await git(["remote", "get-url", "--push", "--all", remote])) !==
          pushUrl ||
        githubRepository(await git(["remote", "get-url", remote])) !==
          repository
      )
        throw new Error("发布期间远端配置变化，请重新核对目标仓库。");
      if ((await remoteHead()) !== base)
        throw new Error("远端基线已推进，请整合后重新规划检查。");
    };
    await publishCandidate(receipt, {
      preflight: async () => {
        await assertRemote();
        await gh([
          "api",
          `repos/${repository}/actions/workflows/verify.yml`,
          "--jq",
          ".state",
        ]).then((state) => {
          if (state !== "active") throw new Error("verify工作流未启用。");
        });
        await withDataLock(async () =>
          assertPrivateRemote(await configureRepository()),
        );
        await guard();
      },
      commit: async () => {
        await guard();
        if ((await git(["write-tree"])) !== originalIndex)
          throw new Error("其他任务改变了暂存区，请协调后重试。");
        if ((await git(["rev-parse", "HEAD^{tree}"])) !== tree) {
          await git(["add", "--all"]);
          if ((await git(["write-tree"])) !== tree)
            throw new Error("暂存内容已变化，未提交候选。");
          await git([
            "commit",
            "-m",
            values.message || "chore: sync workspace code and data",
          ]);
          head = await git(["rev-parse", "HEAD"]);
        }
        await guard();
        await assertCommittedTree(tree);
        return head;
      },
      prepareData: async () =>
        withDataLock(async () => {
          const prepared = await exportCurrent();
          const problems = await taskProcess<string[]>("dependencies", [
            "--root",
            prepared.root,
            "--snapshot",
            prepared.snapshotId,
          ]);
          if (problems.length)
            throw new Error(`业务快照依赖未满足：${problems.join("; ")}`);
          return prepared.snapshotId;
        }),
      check: async () => {
        await command("checks", ["check", "--base", base, "--publication"]);
      },
      assertCandidate: () => guard(),
      publishData: async (snapshotId) => {
        const unlock = await acquireLock("data-sync");
        try {
          publishedLock = (
            await publishData({ expectedSnapshotId: snapshotId })
          ).lock;
        } finally {
          await unlock();
        }
      },
      finalize: async () => {
        assertPublishedLock(publishedLock ?? undefined, await readDataLock());
        // Only the generated lock may differ from the validated candidate.
        const changed = (await git(["diff", "--name-only", "HEAD"]))
          .split("\n")
          .filter(Boolean);
        const untracked = await git([
          "ls-files",
          "--others",
          "--exclude-standard",
        ]);
        if (
          untracked ||
          changed.some((path) => path !== "dev-data.lock.json") ||
          (await git(["rev-parse", "HEAD"])) !== head
        )
          throw new Error(
            "数据发布期间代码发生变化，保留已发布快照，重新验证代码后继续。",
          );
        if (changed.includes("dev-data.lock.json")) {
          finalTree = await candidateTree();
          await command("lock-check", [
            "check",
            "--files",
            "dev-data.lock.json",
          ]);
          await guard(finalTree);
          await git([
            "commit",
            "-m",
            "chore(data): pin shared development snapshot",
            "--only",
            "--",
            "dev-data.lock.json",
          ]);
          head = await git(["rev-parse", "HEAD"]);
        }
        await guard(finalTree);
        await assertCommittedTree(finalTree);
        assertPublishedLock(publishedLock ?? undefined, await readDataLock());
        return head;
      },
      assertRemote,
      push: async (sha) => {
        await guard(finalTree, sha);
        await assertCommittedTree(finalTree);
        assertPublishedLock(publishedLock ?? undefined, await readDataLock());
        console.log(
          await git(["push", "--set-upstream", remote, `${sha}:${remoteRef}`]),
        );
      },
      remoteContains,
      confirmCI: async (sha) =>
        (
          await waitForCI(repository, sha, {
            progress: async (ci) => {
              receipt.ciUrl = ci.url;
              await saveReceipt(receipt);
            },
          })
        ).url,
    });
  } finally {
    await release();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
