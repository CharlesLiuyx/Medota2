import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const slash = (path) => path.replaceAll("\\", "/");

/** Keep the active build's runtime files, including builds under .medota2. */
export function isLocalBuildPath(file, dist) {
  file = slash(file).replace(/^\.\//u, "");
  dist = slash(dist).replace(/^\.\//u, "").replace(/\/$/u, "");
  if (file === dist) return false;
  if (file.startsWith(`${dist}/`)) {
    const child = file.slice(dist.length + 1).split("/")[0];
    return child === "cache" || child === "standalone" || child === "dev";
  }
  const root = file.split("/")[0];
  return (
    root === ".medota2" ||
    root === ".git" ||
    root === ".cache" ||
    root.startsWith(".next") ||
    /^\.env(?:\.|$)/u.test(root) ||
    ["output", "coverage", "playwright-report", "test-results"].includes(root)
  );
}

/** Next 16.3.3 applies trace exclusions to native Windows paths incorrectly. */
export async function pruneBuildTraces({ projectDir, distDir }) {
  const dist = slash(relative(projectDir, distDir));
  let traces = 0;
  let removed = 0;
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        directory === distDir &&
        ["cache", "standalone", "dev"].includes(entry.name)
      )
        continue;
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && entry.name.endsWith(".nft.json")) {
        const trace = JSON.parse(await readFile(file, "utf8"));
        const retained = trace.files.filter(
          (dependency) =>
            !isLocalBuildPath(
              relative(projectDir, resolve(directory, dependency)),
              dist,
            ),
        );
        traces++;
        removed += trace.files.length - retained.length;
        if (retained.length !== trace.files.length)
          await writeFile(file, JSON.stringify({ ...trace, files: retained }));
      }
    }
  }
  await visit(distDir);
  return { traces, removed };
}

/** Reject local state before creating another release copy. */
export async function assertStandaloneBoundary(standalone, dist) {
  for (const entry of await readdir(standalone, { withFileTypes: true }))
    if (isLocalBuildPath(entry.name, dist))
      throw new Error(
        `Standalone artifact contains local state: ${entry.name}`,
      );
}

/** @type {import('next').NextAdapter} */
const adapter = {
  name: "medota2-build-output",
  async onBuildComplete(context) {
    const result = await pruneBuildTraces(context);
    console.log(
      `Build output: excluded ${result.removed} local-state references from ${result.traces} traces.`,
    );
  },
};

export default adapter;
