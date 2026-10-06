import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Only accepts a child handle created by this process, never an arbitrary PID. */
export async function stopChildTree(
  child: ChildProcess | undefined,
): Promise<void> {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  if (process.platform !== "win32") {
    child.kill("SIGTERM");
    return;
  }
  try {
    await execute("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) throw error;
  }
}
