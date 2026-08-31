import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const DEFAULT_STATE_DIRECTORY = ".medota2";

export function getMedota2StateDirectory(): string {
  return resolveMedota2StateDirectory(
    process.cwd(),
    process.env.MEDOTA2_STATE_DIRECTORY,
  );
}

export function ensureMedota2StateDirectory(): string {
  const directory = getMedota2StateDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertNoSymbolicLinkComponents(
    resolve(process.cwd(), DEFAULT_STATE_DIRECTORY),
    directory,
  );
  const metadata = lstatSync(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (typeof process.getuid === "function" && metadata.uid !== process.getuid())
  ) {
    throw new Error(
      "The Medota2 state directory must be a real directory owned by the current user.",
    );
  }
  return directory;
}

export function resolveMedota2StateDirectory(
  workspaceRoot: string,
  configured: string | undefined,
): string {
  const workspace = resolve(workspaceRoot);
  const allowedRoot = resolve(workspace, DEFAULT_STATE_DIRECTORY);
  const value = configured?.trim() || DEFAULT_STATE_DIRECTORY;
  const candidate = resolve(workspace, value);
  const fromAllowedRoot = relative(allowedRoot, candidate);

  if (
    candidate !== allowedRoot &&
    (fromAllowedRoot === ".." ||
      fromAllowedRoot.startsWith("../") ||
      fromAllowedRoot.startsWith("..\\"))
  ) {
    throw new Error(
      "MEDOTA2_STATE_DIRECTORY must resolve inside the workspace .medota2 directory.",
    );
  }
  assertNoSymbolicLinkComponents(allowedRoot, candidate);
  return candidate;
}

function assertNoSymbolicLinkComponents(
  allowedRoot: string,
  candidate: string,
): void {
  const suffix = relative(allowedRoot, candidate);
  const components = suffix ? suffix.split(sep) : [];
  let current = allowedRoot;
  for (const component of ["", ...components]) {
    if (component) current = resolve(current, component);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(
        "MEDOTA2_STATE_DIRECTORY cannot contain symbolic-link path components.",
      );
    }
  }
}
