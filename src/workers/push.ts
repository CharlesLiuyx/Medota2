import { parseArgs } from "node:util";
import { loadLocalEnv } from "@/config/env";
import { acquireLock } from "@/development/runtime";
import { codeGit, publishData } from "@/development/data-sync/publish";

async function main() {
  const { values } = parseArgs({
    options: { message: { type: "string", short: "m" } },
  });
  loadLocalEnv();
  const branch = await codeGit(["symbolic-ref", "--short", "HEAD"]);
  const remote = await codeGit([
    "config",
    "--get",
    `branch.${branch}.remote`,
  ]).catch(() => "origin");
  const remoteRef = await codeGit([
    "config",
    "--get",
    `branch.${branch}.merge`,
  ]).catch(() => `refs/heads/${branch}`);
  const release = await acquireLock("data-sync");
  try {
    // This explicit command publishes the whole local workspace. Gitignore keeps machine data private.
    if (await codeGit(["status", "--porcelain"])) {
      await codeGit(["add", "--all"]);
      await codeGit([
        "commit",
        "-m",
        values.message || "chore: sync workspace code and data",
      ]);
    }
    const head = await codeGit(["rev-parse", "HEAD"]);
    const publication = await publishData();
    if ((await codeGit(["rev-parse", "HEAD"])) !== head)
      throw new Error(
        "Another session changed the code during publication; retry from the current branch.",
      );
    if (await codeGit(["status", "--porcelain", "--", "dev-data.lock.json"])) {
      await codeGit(["add", "--", "dev-data.lock.json"]);
      await codeGit([
        "commit",
        "-m",
        "chore(data): pin shared development snapshot",
        "--only",
        "--",
        "dev-data.lock.json",
      ]);
    }
    console.log(
      await codeGit(["push", "--set-upstream", remote, `HEAD:${remoteRef}`]),
    );
    console.log(
      `Published code and complete data snapshot ${publication.lock.snapshotId}. Run pnpm sync on another machine.`,
    );
  } finally {
    await release();
  }
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Workspace publication failed.",
  );
  process.exitCode = 1;
});
