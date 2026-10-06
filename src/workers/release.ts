import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, readdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  acquireLock,
  fingerprint,
  readJson,
  run,
  writeJson,
} from "@/development/runtime";
import { withTestEnvironment } from "@/development/test-environment";

async function main(): Promise<void> {
  if (process.argv.slice(2).some((arg) => arg !== "--build-only"))
    throw new Error(
      "Usage: pnpm release [--build-only]. Remote deployment is not configured; this command prepares and checks the Web artifact.",
    );
  const release = await acquireLock("release");
  try {
    const inputs = [
      "src",
      "public",
      "drizzle",
      "package.json",
      "pnpm-lock.yaml",
      "next.config.ts",
      "tsconfig.json",
      "tsconfig.check.json",
      "postcss.config.mjs",
      ".env",
      ".env.local",
      ".env.production",
      ".env.production.local",
    ];
    const input = await fingerprint(inputs);
    const key = createHash("sha256")
      .update(
        JSON.stringify({
          input,
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          environment: Object.entries(process.env)
            .filter(([name]) => /^(CI$|NODE_|NEXT_|MEDOTA2_)/.test(name))
            .sort(),
        }),
      )
      .digest("hex");
    const root = resolve(".medota2/releases", key);
    const dist = resolve(".next-release");
    const artifact = resolve(root, "app");
    const manifestPath = resolve(root, "manifest.json");
    const previous = await readJson<{ status: string }>(manifestPath);
    if (
      previous?.status === "passed" &&
      (await access(resolve(artifact, ".next-release/BUILD_ID"))
        .then(() => true)
        .catch(() => false))
    ) {
      console.log(`Reusing checked Web artifact: ${root}`);
      return;
    }
    await withTestEnvironment(
      async (env) => {
        const config = resolve(root, "tsconfig.json");
        const prefix = relative(root, process.cwd());
        await writeJson(config, {
          extends: `${prefix}/tsconfig.json`,
          include: [
            `${prefix}/next-env.d.ts`,
            `${prefix}/src/**/*.ts`,
            `${prefix}/src/**/*.tsx`,
            `${prefix}/.next-release/types/**/*.ts`,
          ],
          exclude: [`${prefix}/node_modules`],
        });
        const buildEnv = {
          ...env,
          MEDOTA2_PROCESS_ROLE: "web",
          MEDOTA2_NEXT_TSCONFIG: relative(process.cwd(), config),
          NEXT_DIST_DIR: relative(process.cwd(), dist),
          MEDOTA2_WORKBENCH: "0",
          NEXT_TELEMETRY_DISABLED: "1",
        };
        await run("pnpm", ["exec", "next", "build", "--webpack"], buildEnv);
        // Standalone tracing can include dotenv files. The release artifact must
        // receive runtime configuration at deployment, never package local secrets.
        await rm(artifact, { recursive: true, force: true });
        await cp(resolve(dist, "standalone"), artifact, { recursive: true });
        await cp(
          resolve(dist, "static"),
          resolve(artifact, ".next-release/static"),
          { recursive: true },
        );
        if (
          await access("public")
            .then(() => true)
            .catch(() => false)
        )
          await cp("public", resolve(artifact, "public"), { recursive: true });
        await cp("drizzle", resolve(artifact, "drizzle"), { recursive: true });
        await removeDotEnv(artifact);
        if (
          await access(resolve(artifact, ".medota2"))
            .then(() => true)
            .catch(() => false)
        )
          throw new Error(
            "Standalone artifact unexpectedly contains local state.",
          );
        const smokeRoot = resolve(root, "smoke");
        await rm(smokeRoot, { recursive: true, force: true });
        try {
          await cp(artifact, smokeRoot, { recursive: true });
          const smokeState = resolve(smokeRoot, ".medota2/runtime");
          await mkdir(smokeState, { recursive: true, mode: 0o700 });
          for (const file of [
            "environment-identities.v1.json",
            "database-credentials.v1.json",
          ]) {
            await cp(
              resolve(env.MEDOTA2_STATE_DIRECTORY!, file),
              resolve(smokeState, file),
            );
          }
          const port = await availablePort();
          const child = spawn(
            process.execPath,
            [resolve(smokeRoot, "server.js")],
            {
              cwd: smokeRoot,
              env: {
                ...buildEnv,
                MEDOTA2_STATE_DIRECTORY: ".medota2/runtime",
                PORT: String(port),
                HOSTNAME: "127.0.0.1",
              },
              stdio: "inherit",
            },
          );
          let exited = false;
          child.once("error", () => {
            exited = true;
          });
          child.once("close", () => {
            exited = true;
          });
          const stop = () => child.kill("SIGTERM");
          process.once("SIGINT", stop);
          process.once("SIGTERM", stop);
          try {
            const deadline = Date.now() + 45_000;
            let healthy = false;
            while (!exited && Date.now() < deadline) {
              const response = await fetch(
                `http://127.0.0.1:${port}/api/catalog/heroes?q=antimage`,
                { signal: AbortSignal.timeout(2000) },
              ).catch(() => null);
              if (response && response.status >= 500)
                throw new Error(
                  `Standalone Catalog API failed (${response.status}); see the server error above.`,
                );
              healthy =
                !!response?.ok &&
                response.headers.get("x-medota2-environment-verification") ===
                  "verified";
              if (healthy) break;
              await delay(300);
            }
            if (!healthy)
              throw new Error(
                "The production Web artifact did not pass its database-backed startup check.",
              );
            const page = await fetch(`http://127.0.0.1:${port}/heroes`);
            const html = await page.text();
            if (!page.ok) throw new Error("Standalone page failed.");
            const assetPaths = [
              ...html.matchAll(/(?:src|href)="([^"]*\/_next\/[^"]+)"/g),
            ].map((match) => match[1]);
            if (!assetPaths.length)
              throw new Error("Standalone page has no generated assets.");
            for (const path of assetPaths.slice(0, 3)) {
              if (!(await fetch(new URL(path, `http://127.0.0.1:${port}`))).ok)
                throw new Error("Standalone static asset is missing.");
            }
            for (const developmentPath of [
              "/api/development",
              "/api/development/database",
              "/dev/database",
            ]) {
              const developmentApi = await fetch(
                `http://127.0.0.1:${port}${developmentPath}`,
              );
              if (developmentApi.status !== 404)
                throw new Error(
                  "Production artifact exposed the development API.",
                );
            }
          } finally {
            child.kill("SIGTERM");
            process.off("SIGINT", stop);
            process.off("SIGTERM", stop);
            if (!exited)
              await new Promise<void>((accept) =>
                child.once("close", () => accept()),
              );
          }
        } finally {
          await rm(smokeRoot, { recursive: true, force: true });
        }
        if (input !== (await fingerprint(inputs)))
          throw new Error(
            "Source or configuration changed during build; the artifact is stale.",
          );
        await writeJson(manifestPath, {
          schemaVersion: 1,
          status: "passed",
          unit: "web",
          key,
          input,
          builtAt: new Date().toISOString(),
          node: process.version,
          platform: process.platform,
          architecture: process.arch,
          smoke:
            "standalone Web, verified Catalog API, static assets and disabled development API",
          artifact: "app",
          deployment: "not-configured",
        });
        console.log(
          `Checked Web artifact: ${root}\nDeployment target is not configured; no remote publication was performed.`,
        );
      },
      { seed: true },
    );
  } finally {
    await release();
  }
}
async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No build smoke port.");
  await new Promise<void>((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  );
  return address.port;
}
async function removeDotEnv(root: string): Promise<void> {
  for (const entry of await readdir(root, { withFileTypes: true }).catch(
    () => [],
  )) {
    const path = resolve(root, entry.name);
    if (!entry.isDirectory() && /^\.env(?:\.|$)/.test(entry.name))
      await rm(path);
    else if (entry.isDirectory()) await removeDotEnv(path);
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
