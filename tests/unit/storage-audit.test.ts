import {
  mkdtemp,
  mkdir,
  writeFile,
  truncate,
  rm,
  symlink,
} from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { auditStorage } from "@/development/storage-audit";

it("reports unbudgeted growth without following links or deleting evidence", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "medota2-audit-"));
  try {
    await mkdir(resolve(root, ".medota2/research"), { recursive: true });
    const file = resolve(root, ".medota2/research/dump");
    await writeFile(file, "");
    await truncate(file, 257 * 1024 ** 2);
    await symlink(
      root,
      resolve(root, "cycle"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const audit = await auditStorage(root);
    expect(
      audit.entries.find((entry) => entry.path === ".medota2/research"),
    ).toMatchObject({ bytes: 257 * 1024 ** 2, warning: true });
    expect(audit.totalBytes).toBeLessThan(258 * 1024 ** 2);
    expect((await auditStorage(root)).totalBytes).toBe(audit.totalBytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
