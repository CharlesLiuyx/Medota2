import { createServer } from "node:net";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  readSyncWorkspace,
  workspaceSchema,
  syncRoot,
  type SyncWorkspace,
} from "@/config/data-sync-state";
import { acquireLock, readJson, processAlive } from "@/development/runtime";
import { atomicJson } from "./files";

export async function ensureWorkspace(
  options: { name?: string; profile?: string; port?: number } = {},
): Promise<SyncWorkspace> {
  const release = await acquireLock("data-sync-workspace");
  try {
    const existing = readSyncWorkspace();
    if (existing) {
      if (
        (options.name && options.name !== existing.environmentName) ||
        (options.profile && options.profile !== existing.profile) ||
        (options.port && options.port !== existing.webPort)
      )
        throw new Error(
          "Workspace already exists with different settings. Keep its identity and review configuration changes explicitly.",
        );
      return existing;
    }
    const owner = await readJson<{ pid: number; workspace: string }>(
      resolve(".medota2/development/owner.json"),
    );
    const ownServer =
      owner?.workspace === process.cwd() && processAlive(owner.pid);
    const port = options.port ?? (ownServer ? 3000 : await availablePort(3000));
    const workspace = workspaceSchema.parse({
      version: 1,
      id: randomUUID(),
      environmentName:
        options.name || process.env.MEDOTA2_ENVIRONMENT_NAME || hostname(),
      profile: options.profile || "local",
      root: process.cwd(),
      webPort: port,
    });
    await atomicJson(resolve(syncRoot(), "workspace.json"), workspace);
    return workspace;
  } finally {
    await release();
  }
}
async function availablePort(preferred: number): Promise<number> {
  const bind = (port: number) =>
    new Promise<number>((accept, reject) => {
      const server = createServer();
      server.unref();
      server.once("error", reject);
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        const address = server.address();
        const assigned =
          typeof address === "object" && address ? address.port : 0;
        server.close((error) => (error ? reject(error) : accept(assigned)));
      });
    });
  try {
    return await bind(preferred);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    return bind(0);
  }
}
