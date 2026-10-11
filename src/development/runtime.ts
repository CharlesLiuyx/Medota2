import { spawn, execFile } from "node:child_process";
import { nativeCommand } from "./command";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { createWriteStream } from "node:fs";
import type { Writable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

export const workspace = process.cwd();
export const developmentRoot = resolve(workspace, ".medota2/development");
let commandOutput: Writable | undefined;

/** Route supervised commands through the workbench's rotating log. */
export function setCommandOutput(output: Writable): () => void {
  const previous = commandOutput;
  commandOutput = output;
  return () => {
    commandOutput = previous;
  };
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(temporary, path);
}

export function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Only serialize operations that mutate a shared resource; ordinary editing stays concurrent. */
export async function acquireLock(
  name: string,
  waitMs = 600_000,
  signal?: AbortSignal,
): Promise<() => Promise<void>> {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error("Invalid lock name.");
  const directory = resolve(workspace, ".medota2/locks");
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${name}.json`);
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  const deadline = Date.now() + waitMs;
  let announced = false;
  const guard = `${path}.guard`;
  for (;;) {
    signal?.throwIfAborted();
    // Serialize acquisition and dead-owner recovery, so two sessions cannot
    // both remove a stale file and accidentally delete the new owner's lock.
    let guarded = false;
    try {
      await mkdir(guard);
      guarded = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const info = await stat(guard).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 30_000)
        throw new Error(
          `Interrupted lock acquisition: inspect ${guard} before removing it.`,
        );
    }
    if (guarded) {
      try {
        const content = await readFile(path, "utf8").catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          return null;
        });
        if (content !== null) {
          const current = JSON.parse(content) as { pid: number };
          if (!processAlive(current.pid)) await unlink(path);
        }
        try {
          const file = await open(path, "wx", 0o600);
          try {
            await file.writeFile(owner);
          } finally {
            await file.close();
          }
          return async () => {
            if ((await readFile(path, "utf8").catch(() => "")) === owner)
              await unlink(path);
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      } finally {
        await rmdir(guard);
      }
    }
    if (Date.now() >= deadline)
      throw new Error(`${name} is in use; see ${path}.`);
    if (!announced) {
      console.log(`[queue] Waiting for ${name}.`);
      announced = true;
    }
    await delay(200, undefined, { signal });
  }
}

export class CommandAbortedError extends Error {}

export async function run(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  logPath?: string,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  if (logPath) await mkdir(dirname(logPath), { recursive: true });
  const log = logPath ? createWriteStream(logPath, { mode: 0o600 }) : undefined;
  const invocation = nativeCommand(command, args, env);
  const child = spawn(invocation.command, invocation.args, {
    cwd: workspace,
    env,
    windowsHide: true,
    detached: Boolean(signal) && process.platform !== "win32",
    stdio: log || commandOutput ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (log) {
    child.stdout?.on("data", (chunk: Buffer) => {
      log.write(chunk);
      (commandOutput ?? process.stdout).write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      log.write(chunk);
      (commandOutput ?? process.stderr).write(chunk);
    });
  } else if (commandOutput) {
    child.stdout?.pipe(commandOutput, { end: false });
    child.stderr?.pipe(commandOutput, { end: false });
  }
  let stopping = false;
  let stoppedAt = 0;
  let terminationError: unknown;
  let windowsTermination: Promise<void> | undefined;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const terminate = (force = false) => {
    if (!child.pid) return;
    if (signal && process.platform !== "win32") {
      try {
        process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH")
          terminationError = error;
      }
    } else if (signal && process.platform === "win32") {
      // Windows has no POSIX process groups. Restrict termination to this owned child tree.
      windowsTermination ??= new Promise<void>((accept) => {
        execFile(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", "/F"],
          { windowsHide: true },
          (error) => {
            if (error) terminationError = error;
            accept();
          },
        );
      });
    } else child.kill(force ? "SIGKILL" : "SIGTERM");
  };
  const stop = () => {
    if (stopping) return;
    stopping = true;
    stoppedAt = Date.now();
    terminate();
    escalation = setTimeout(() => terminate(true), 10_000);
    escalation.unref();
  };
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await new Promise<void>((accept, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) =>
        code === 0 && !stopping
          ? accept()
          : reject(
              new (stopping ? CommandAbortedError : Error)(
                `${command} ${args.join(" ")} failed (${signal ?? code}).`,
              ),
            ),
      );
    });
  } finally {
    // A parent can close its pipes before its descendants exit. Confirm the entire
    // owned POSIX group is gone before resolving; the escalation remains armed.
    if (stopping && signal && child.pid && process.platform !== "win32") {
      for (;;) {
        try {
          process.kill(-child.pid, 0);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
          terminationError = error;
          break;
        }
        if (Date.now() - stoppedAt > 12_000) {
          terminationError = new Error(
            `Cancelled command group ${child.pid} has not exited.`,
          );
          break;
        }
        await delay(25);
      }
    }
    await windowsTermination;
    if (escalation) clearTimeout(escalation);
    signal?.removeEventListener("abort", stop);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    if (log) await new Promise<void>((accept) => log.end(accept));
    if (terminationError) throw terminationError;
  }
}

/** Content identity, including paths/deletions, independent of modification timestamps. */
export async function fingerprint(inputs: readonly string[]): Promise<string> {
  const files = new Set<string>();
  async function visit(path: string): Promise<void> {
    try {
      const info = await stat(path);
      if (info.isDirectory()) {
        for (const name of (await readdir(path)).sort())
          await visit(resolve(path, name));
      } else if (info.isFile()) files.add(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      files.add(path);
    }
  }
  for (const input of inputs) await visit(resolve(workspace, input));
  const hash = createHash("sha256");
  for (const path of [...files].sort()) {
    hash.update(relative(workspace, path)).update("\0");
    const content = await readFile(path).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
        return Buffer.from("<missing>");
      },
    );
    hash
      .update(String(content.length))
      .update("\0")
      .update(content)
      .update("\0");
  }
  return hash.digest("hex");
}
