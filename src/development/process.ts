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
    await new Promise<void>((accept, reject) => {
      const force = setTimeout(() => child.kill("SIGKILL"), 10_000);
      const deadline = setTimeout(() => {
        cleanup();
        reject(new Error(`Owned child ${child.pid} did not stop.`));
      }, 15_000);
      const cleanup = () => {
        clearTimeout(force);
        clearTimeout(deadline);
        child.off("close", closed);
      };
      const closed = () => {
        cleanup();
        accept();
      };
      child.once("close", closed);
      child.kill("SIGTERM");
    });
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
