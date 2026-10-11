import { existsSync } from "node:fs";
import { basename, delimiter, resolve } from "node:path";

/** pnpm prepends the same module paths at every nested invocation. Repeated
 * entries do not change resolution; preserve the first occurrence and order. */
export function normalizeNodePath(
  value: string | undefined,
): string | undefined {
  return value === undefined
    ? undefined
    : [...new Set(value.split(delimiter))].join(delimiter);
}

/** Invoke pnpm's JavaScript entry directly on Windows, without a command shell. */
export function nativeCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): { command: string; args: string[] } {
  if (process.platform !== "win32" || command !== "pnpm")
    return { command, args: [...args] };
  const inherited = env.npm_execpath;
  const paths = (env.PATH || env.Path || "").split(delimiter);
  const candidates = [
    ...(inherited && /^pnpm\.(?:cjs|mjs|js)$/i.test(basename(inherited))
      ? [inherited]
      : []),
    ...paths.flatMap((path) =>
      ["pnpm.cjs", "pnpm.mjs"].map((name) =>
        resolve(path, "node_modules/pnpm/bin", name),
      ),
    ),
  ];
  const entry = candidates.find((path) => existsSync(path));
  if (!entry)
    throw new Error(
      "Cannot locate pnpm's JavaScript entry. Run through pnpm or install the pinned pnpm on PATH.",
    );
  return { command: process.execPath, args: [entry, ...args] };
}
