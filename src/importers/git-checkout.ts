import { execFile } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { promisify } from "node:util";
import { sha256 } from "@/lib/hash";

const execFileAsync = promisify(execFile);

export interface CheckedSourceFile {
  path: string;
  bytes: Buffer;
  text: string;
  sha256: string;
  sizeBytes: number;
  encoding: "ascii" | "utf-8" | "utf-8-bom";
}

export interface GitCheckoutSnapshot {
  root: string;
  remoteUrl: string;
  commit: string;
  dirty: boolean;
  inputsMatchHead: true;
  files: CheckedSourceFile[];
  manifestSha256: string;
}

export async function inspectGitCheckout(
  rootInput: string,
  paths: readonly string[],
): Promise<GitCheckoutSnapshot> {
  const root = await realpath(rootInput).catch(() => {
    throw new Error(`Source checkout does not exist: ${rootInput}`);
  });
  const rootStats = await stat(root);
  if (!rootStats.isDirectory())
    throw new Error(`Source checkout is not a directory: ${root}`);

  const gitRoot = await gitText(root, ["rev-parse", "--show-toplevel"]);
  if ((await realpath(gitRoot)) !== root) {
    throw new Error(
      `Configured source path must be the Git checkout root: ${root}`,
    );
  }

  const commit = await gitText(root, ["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/u.test(commit))
    throw new Error(`Git HEAD did not resolve to a full commit: ${commit}`);
  const remoteUrl = await gitText(root, ["remote", "get-url", "origin"]);
  const statusOutput = await gitText(
    root,
    ["status", "--porcelain=v1", "--untracked-files=normal"],
    true,
  );
  const files: CheckedSourceFile[] = [];

  for (const sourcePath of paths) {
    if (
      sourcePath.includes("\t") ||
      sourcePath.includes("\n") ||
      sourcePath.startsWith("/") ||
      sourcePath.includes("..")
    ) {
      throw new Error(`Unsafe repository-relative source path: ${sourcePath}`);
    }
    const absolutePath = resolve(root, sourcePath);
    if (!absolutePath.startsWith(`${root}${sep}`))
      throw new Error(`Source path escapes checkout: ${sourcePath}`);

    await gitText(root, ["ls-files", "--error-unmatch", "--", sourcePath]);
    const bytes = await readFile(absolutePath).catch(() => {
      throw new Error(
        `Required source file is missing or unreadable: ${sourcePath}`,
      );
    });
    const headBytes = await gitBytes(root, ["show", `HEAD:${sourcePath}`]);
    if (!bytes.equals(headBytes)) {
      throw new Error(
        `Source input differs from HEAD and cannot be imported: ${sourcePath}`,
      );
    }
    const decoded = decodeSource(bytes, sourcePath);
    files.push({
      path: sourcePath,
      bytes,
      text: decoded.text,
      sha256: sha256(bytes),
      sizeBytes: bytes.byteLength,
      encoding: decoded.encoding,
    });
  }

  const manifest = [...files]
    .sort((a, b) => Buffer.from(a.path).compare(Buffer.from(b.path)))
    .map((file) => `${file.path}\t${file.sha256}\t${file.sizeBytes}\n`)
    .join("");

  return {
    root,
    remoteUrl,
    commit,
    dirty: statusOutput.length > 0,
    inputsMatchHead: true,
    files,
    manifestSha256: sha256(Buffer.from(manifest, "utf8")),
  };
}

function decodeSource(
  bytes: Buffer,
  sourcePath: string,
): { text: string; encoding: CheckedSourceFile["encoding"] } {
  const hasBom =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf;
  const payload = hasBom ? bytes.subarray(3) : bytes;
  const ascii = payload.every((byte) => byte < 0x80);
  try {
    const text = new TextDecoder("utf-8", { fatal: true })
      .decode(payload)
      .replace(/\r\n?/gu, "\n");
    return { text, encoding: hasBom ? "utf-8-bom" : ascii ? "ascii" : "utf-8" };
  } catch {
    throw new Error(`Source file is not ASCII or valid UTF-8: ${sourcePath}`);
  }
}

async function gitText(
  cwd: string,
  args: string[],
  allowEmpty = false,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    const output = stdout.trim();
    if (!allowEmpty && !output) throw new Error("empty output");
    return output;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Git command failed in ${cwd}: git ${args.join(" ")} (${detail})`,
    );
  }
}

function gitBytes(cwd: string, args: string[]): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "git",
      args,
      { cwd, encoding: "buffer", maxBuffer: 32 * 1024 * 1024 },
      (error, stdout) => {
        if (error)
          reject(
            new Error(
              `Git command failed in ${cwd}: git ${args.join(" ")} (${error.message})`,
            ),
          );
        else resolvePromise(stdout as Buffer);
      },
    );
  });
}
