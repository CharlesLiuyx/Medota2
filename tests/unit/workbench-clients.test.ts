import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createWorkbenchClient,
  hasWorkbenchClients,
} from "@/development/workbench-clients";

describe("foreground workbench clients", () => {
  it("keeps a shared workbench alive until the final terminal leaves", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "medota2-clients-"));
    try {
      const first = await createWorkbenchClient(root);
      const second = await createWorkbenchClient(root);
      expect(await hasWorkbenchClients(root)).toBe(true);
      await first.close();
      await second.pulse();
      expect(await hasWorkbenchClients(root)).toBe(true);
      await second.close();
      expect(await hasWorkbenchClients(root)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("reclaims abandoned terminal leases without stopping another terminal", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "medota2-clients-"));
    try {
      await createWorkbenchClient(root);
      const directory = resolve(root, "clients");
      const [name] = await readdir(directory);
      const path = resolve(directory, name);
      const lease = JSON.parse(await readFile(path, "utf8"));
      const live = await createWorkbenchClient(root);
      await writeFile(
        path,
        JSON.stringify({ ...lease, updatedAt: Date.now() - 60_000 }),
      );
      expect(await hasWorkbenchClients(root)).toBe(true);
      expect(await readdir(directory)).toHaveLength(1);
      await live.close();
      await writeFile(
        path,
        JSON.stringify({ ...lease, parentPid: 2147483647 }),
      );
      expect(await hasWorkbenchClients(root)).toBe(false);
      expect(await readdir(directory)).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
