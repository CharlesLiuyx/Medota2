import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

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

// A local preview must not reuse an immutable candidate made by different code.
export async function readWorkingTreeFingerprint(
  root = process.cwd(),
): Promise<string> {
  const { stdout } = await execFileAsync(
    "git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "src",
      "package.json",
      "pnpm-lock.yaml",
      "tsconfig.json",
    ],
    { cwd: root, encoding: "utf8" },
  );
  const digest = createHash("sha256");
  for (const path of [...new Set(stdout.split("\0").filter(Boolean))].sort()) {
    const bytes = await readFile(resolve(root, path)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    digest.update(`${path}\0${bytes?.length ?? "deleted"}\0`);
    if (bytes) digest.update(bytes);
  }
  return digest.digest("hex");
}
