import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface BuildIdentity {
  buildId: string;
  commit: string;
  clean: boolean;
}

export async function readBuildIdentity(
  root = process.cwd(),
): Promise<BuildIdentity> {
  const packageJson = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  ) as { version?: string };
  if (!packageJson.version)
    throw new Error("package.json.version is required for MEDOTA2_BUILD_ID.");

  const [{ stdout: commitOutput }, { stdout: statusOutput }] =
    await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }),
      execFileAsync("git", ["status", "--porcelain=v1"], {
        cwd: root,
        encoding: "utf8",
      }),
    ]);
  const commit = commitOutput.trim();
  if (!/^[0-9a-f]{40}$/u.test(commit))
    throw new Error("Medota2 HEAD did not resolve to a full Git commit.");

  return {
    buildId: `medota2@${packageJson.version}+git.${commit}`,
    commit,
    clean: statusOutput.trim().length === 0,
  };
}

export function assertSourceImportBuildIsClean(identity: BuildIdentity): void {
  if (!identity.clean) {
    throw new Error(
      "Medota2 has uncommitted changes. A formal tsx source import cannot promote an active dataset; commit the implementation first.",
    );
  }
}
