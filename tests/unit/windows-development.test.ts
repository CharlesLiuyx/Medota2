import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertPrivateRegularFile,
  protectPrivateDirectory,
} from "@/config/private-file";
import { nativeCommand } from "@/development/command";
import { stopChildTree } from "@/development/process";

describe("native development admission", () => {
  it.runIf(process.platform === "win32")(
    "stops only the owned process tree",
    async () => {
      const sibling = spawn(
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { windowsHide: true },
      );
      const parent = spawn(
        process.execPath,
        [
          "-e",
          "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); process.stdout.write(String(child.pid)); setInterval(()=>{},1000);",
        ],
        { windowsHide: true },
      );
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      try {
        const [output] = await once(parent.stdout!, "data");
        const descendant = Number(output.toString());
        expect(Number.isSafeInteger(descendant)).toBe(true);
        const closed = once(parent, "close");
        await stopChildTree(parent);
        await closed;
        for (let i = 0; i < 20 && alive(descendant); i++) await delay(50);
        expect(alive(descendant)).toBe(false);
        expect(alive(sibling.pid!)).toBe(true);
      } finally {
        await stopChildTree(parent);
        await stopChildTree(sibling);
      }
    },
    30_000,
  );
  it("admits a private receipt and rejects a grant to another user group", () => {
    const directory = mkdtempSync(resolve(tmpdir(), "medota2-private-"));
    try {
      if (process.platform === "win32") {
        const sid = execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
          ],
          { encoding: "utf8", windowsHide: true },
        ).trim();
        // Workspaces may inherit Modify without WRITE_OWNER. The existing
        // owner must still be able to protect its DACL without changing owner.
        execFileSync(
          "icacls.exe",
          [directory, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)M`],
          { windowsHide: true },
        );
      }
      protectPrivateDirectory(directory);
      protectPrivateDirectory(directory);
      const path = resolve(directory, "receipt.json");
      writeFileSync(path, "{}", { mode: 0o600 });
      expect(() => assertPrivateRegularFile(path)).not.toThrow();
      if (process.platform === "win32")
        execFileSync("icacls.exe", [path, "/grant", "*S-1-5-32-545:R"], {
          windowsHide: true,
        });
      else chmodSync(path, 0o644);
      expect(() => assertPrivateRegularFile(path)).toThrow();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);

  it.runIf(process.platform === "win32")(
    "runs pnpm with literal shell metacharacters in an argument",
    () => {
      const literal = "space & echo unexpected | 'quoted' 中文";
      const invocation = nativeCommand(
        "pnpm",
        [
          "exec",
          "node",
          "-e",
          "process.stdout.write(process.argv[1])",
          literal,
        ],
        process.env,
      );
      expect(
        execFileSync(invocation.command, invocation.args, {
          encoding: "utf8",
          windowsHide: true,
        }),
      ).toBe(literal);
    },
    30_000,
  );
});
