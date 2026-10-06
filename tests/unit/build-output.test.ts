import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import { expect, it } from "vitest";
import {
  assertStandaloneBoundary,
  isLocalBuildPath,
  pruneBuildTraces,
} from "../../scripts/development/build-output.mjs";

it("prunes local snapshots and nested releases while retaining runtime dependencies", async () => {
  const projectDir = await mkdtemp(resolve(tmpdir(), "medota2-build-output-"));
  try {
    const distDir = resolve(projectDir, ".next-release");
    const directory = resolve(distDir, "server");
    await mkdir(directory, { recursive: true });
    const file = resolve(directory, "page.js.nft.json");
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        files: [
          "../../.medota2/releases/old/app/server.js",
          "../../.medota2/data-sync/active.json",
          "../../.git/config",
          "../../.env.production",
          "../../.next/dev/server/page.js",
          "../standalone/server.js",
          "../cache/webpack/0.pack",
          "./runtime.js",
          "../../node_modules/next/package.json",
          "../../drizzle/0001.sql",
        ],
      }),
    );
    const developmentRoute = resolve(directory, "app/dev/database");
    await mkdir(developmentRoute, { recursive: true });
    await writeFile(
      resolve(developmentRoute, "page.js.nft.json"),
      JSON.stringify({
        version: 1,
        files: [
          relative(
            developmentRoute,
            resolve(projectDir, ".medota2/data-sync/active.json"),
          ),
        ],
      }),
    );
    expect(await pruneBuildTraces({ projectDir, distDir })).toEqual({
      traces: 2,
      removed: 8,
    });
    expect(JSON.parse(await readFile(file, "utf8")).files).toEqual([
      "./runtime.js",
      "../../node_modules/next/package.json",
      "../../drizzle/0001.sql",
    ]);
    const standalone = resolve(distDir, "standalone");
    await mkdir(resolve(standalone, ".next-release"), { recursive: true });
    await assertStandaloneBoundary(standalone, ".next-release");
    await mkdir(resolve(standalone, ".medota2"));
    await expect(
      assertStandaloneBoundary(standalone, ".next-release"),
    ).rejects.toThrow("local state: .medota2");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

it("handles both separators and retains an active build under local state", () => {
  expect(
    isLocalBuildPath(
      ".medota2\\releases\\old\\app\\server.js",
      ".next-release",
    ),
  ).toBe(true);
  expect(
    isLocalBuildPath(
      ".medota2\\test-runs\\build\\server\\page.js",
      ".medota2/test-runs/build",
    ),
  ).toBe(false);
  expect(
    isLocalBuildPath(
      ".medota2/test-runs/build/cache/0.pack",
      ".medota2/test-runs/build",
    ),
  ).toBe(true);
  expect(isLocalBuildPath("../shared/runtime.js", ".next-release")).toBe(false);
});
