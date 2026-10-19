import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { stopChildTree } from "@/development/process";
import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { processAlive, readJson, writeJson } from "@/development/runtime";

interface Client {
  pid: number;
  parentPid: number;
  updatedAt: number;
}

/** A foreground command owns one lease; browsers do not keep the workbench alive. */
export async function createWorkbenchClient(root: string) {
  const directory = resolve(root, "clients");
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${randomUUID()}.json`);
  const parentPid = process.ppid;
  const pulse = () =>
    writeJson(path, {
      pid: process.pid,
      parentPid,
      updatedAt: Date.now(),
    } satisfies Client);
  await pulse();
  return {
    pulse,
    parentAlive: () => process.ppid === parentPid && processAlive(parentPid),
    close: () => rm(path, { force: true }),
  };
}

export async function hasWorkbenchClients(root: string): Promise<boolean> {
  const directory = resolve(root, "clients");
  const files = await readdir(directory).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  let active = false;
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const path = resolve(directory, file);
    const client = await readJson<Client>(path);
    if (
      client &&
      Number.isSafeInteger(client.pid) &&
      client.pid > 0 &&
      Number.isSafeInteger(client.parentPid) &&
      client.parentPid > 0 &&
      Date.now() - client.updatedAt < 10_000 &&
      processAlive(client.pid) &&
      processAlive(client.parentPid)
    )
      active = true;
    else await rm(path, { force: true });
  }
  return active;
}

/** Internal callers hold the foreground client only for their own operation. */
export async function withWorkbench<T>(
  operation: () => Promise<T>,
  restart = false,
): Promise<T> {
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "src/workers/dev.ts",
      ...(restart ? ["--restart"] : []),
    ],
    { stdio: ["ignore", "inherit", "inherit", "ipc"], windowsHide: true },
  );
  try {
    await new Promise<void>((accept, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Workbench startup timed out.")),
        180_000,
      );
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`Workbench exited before ready (${code}).`));
      });
      child.once("message", (message) => {
        clearTimeout(timeout);
        if ((message as { kind?: string }).kind === "ready") accept();
        else reject(new Error("Unexpected workbench readiness message."));
      });
    });
    return await operation();
  } finally {
    await stopChildTree(child);
    if (process.platform !== "win32" && child.exitCode !== 0)
      throw new Error(
        `Workbench client did not exit cleanly (${child.exitCode ?? child.signalCode}).`,
      );
  }
}
