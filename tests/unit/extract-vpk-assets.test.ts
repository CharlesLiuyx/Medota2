import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readValveAssetExtractionManifest,
  validateValveAssetExtractionManifest,
  VALVE_ASSET_EXTRACTION_MANIFEST_FILE,
  VALVE_ASSET_EXTRACTION_SCHEMA,
  VALVE_ASSET_EXTRACTION_SCHEMA_VERSION,
} from "@/importers/valve-assets/extraction-manifest";
import {
  buildSource2ViewerArgs,
  extractVpkAssets,
  resolveVpkAssetExtractionConfig,
  SOURCE2VIEWER_VPK_PATH_FILTERS,
  type SpawnSource2Viewer,
  type VpkAssetExtractionConfig,
} from "@/workers/extract-vpk-assets";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("VPK asset extraction", () => {
  it("constructs a narrowly filtered decompile invocation", () => {
    expect(
      buildSource2ViewerArgs({
        vpkPath: "/game/dota/pak01_dir.vpk",
        outputPath: "/cache/valve-assets",
        threads: 6,
      }),
    ).toEqual([
      "--input",
      "/game/dota/pak01_dir.vpk",
      "--output",
      "/cache/valve-assets",
      "-d",
      "--vpk_extensions",
      "vtex_c",
      "--vpk_filepath",
      SOURCE2VIEWER_VPK_PATH_FILTERS.join(","),
      "--texture_decode_flags",
      "auto",
      "--threads",
      "6",
    ]);
  });

  it("requires ClientVersion and lets CLI values override the environment", () => {
    const cwd = "/workspace/medota2";
    const config = resolveVpkAssetExtractionConfig(
      [
        "--vpk",
        "../game/pak01_dir.vpk",
        "--output",
        "./override",
        "--client-version",
        "7000",
      ],
      {
        DOTA_VPK_PATH: "ignored.vpk",
        SOURCE2VIEWER_CLI_PATH: "./tools/Source2Viewer-CLI",
        DOTA_VALVE_ASSET_PATH: "./from-env",
        DOTA_VALVE_ASSET_CLIENT_VERSION: "6918",
      },
      cwd,
    );

    expect(config).toMatchObject({
      vpkPath: resolve(cwd, "../game/pak01_dir.vpk"),
      cliPath: resolve(cwd, "./tools/Source2Viewer-CLI"),
      outputPath: resolve(cwd, "./override"),
      clientVersion: "7000",
    });
    expect(
      resolveVpkAssetExtractionConfig(
        [],
        {
          DOTA_VPK_PATH: "../game/pak01_dir.vpk",
          SOURCE2VIEWER_CLI_PATH: "./tools/Source2Viewer-CLI",
          DOTA_VALVE_ASSET_PATH: "./assets",
          DOTA_VALVE_ASSET_CLIENT_VERSION: "6918",
        },
        cwd,
      ),
    ).toMatchObject({
      outputPath: resolve(cwd, "./assets"),
      clientVersion: "6918",
    });
    expect(() =>
      resolveVpkAssetExtractionConfig(
        [],
        {
          DOTA_VPK_PATH: "../game/pak01_dir.vpk",
          SOURCE2VIEWER_CLI_PATH: "./tools/Source2Viewer-CLI",
          DOTA_VALVE_ASSET_PATH: "./assets",
        },
        cwd,
      ),
    ).toThrow("DOTA_VALVE_ASSET_CLIENT_VERSION is required");
  });

  it("extracts through a sibling staging directory and atomically publishes a provenance manifest", async () => {
    const fixture = await extractionFixture();
    const spawnProcess = source2ViewerMock();
    const extractedAt = new Date("2026-08-31T01:23:45.000Z");

    const manifest = await extractVpkAssets(fixture.config, {
      now: () => extractedAt,
      spawnProcess,
    });
    const stored = await readValveAssetExtractionManifest(
      fixture.config.outputPath,
      { clientVersion: "6918", vpkSha256: manifest.vpk.sha256 },
    );

    expect(stored).toEqual(manifest);
    await expect(
      readValveAssetExtractionManifest(fixture.config.outputPath, {
        clientVersion: "6917",
      }),
    ).rejects.toThrow("ClientVersion mismatch");
    expect(manifest).toMatchObject({
      schema: VALVE_ASSET_EXTRACTION_SCHEMA,
      schemaVersion: VALVE_ASSET_EXTRACTION_SCHEMA_VERSION,
      clientVersion: "6918",
      extractedAt: extractedAt.toISOString(),
      vpk: {
        byteSize: fixture.vpkBytes.byteLength,
        sha256: createHash("sha256").update(fixture.vpkBytes).digest("hex"),
      },
      source2Viewer: {
        version: "ValveResourceFormat 12.3.4",
        filters: [...SOURCE2VIEWER_VPK_PATH_FILTERS],
        extensions: ["vtex_c"],
        textureDecodeFlags: "auto",
        threads: 4,
      },
      extractedFileCount: 1,
    });
    expect(manifest.source2Viewer.arguments).toEqual(
      buildSource2ViewerArgs({
        ...fixture.config,
        vpkPath: manifest.source2Viewer.arguments[1],
        outputPath: manifest.source2Viewer.arguments[3],
      }),
    );
    expect(manifest.source2Viewer.arguments[3]).toContain(
      ".assets-6918.staging-",
    );
    await expect(
      access(
        join(
          fixture.config.outputPath,
          "panorama/images/spellicons/fixture_png.png",
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      access(
        join(fixture.config.outputPath, VALVE_ASSET_EXTRACTION_MANIFEST_FILE),
      ),
    ).resolves.toBeUndefined();
    expect(
      (await readdir(dirname(fixture.config.outputPath))).filter((name) =>
        name.startsWith(".assets-6918.staging-"),
      ),
    ).toEqual([]);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual(["--version"]);
    expect(spawnProcess.mock.calls[0]?.[2]).toMatchObject({
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(spawnProcess.mock.calls[1]?.[2]).toMatchObject({
      shell: false,
      stdio: "inherit",
    });
  });

  it("rejects every pre-existing final output before launching Source2Viewer", async () => {
    const fixture = await extractionFixture();
    const spawnProcess = source2ViewerMock();
    for (const name of ["empty", "non-empty"]) {
      const outputPath = join(dirname(fixture.config.outputPath), name);
      await mkdir(outputPath);
      if (name === "non-empty") {
        await writeFile(join(outputPath, "stale.png"), "stale");
      }
      await expect(
        extractVpkAssets({ ...fixture.config, outputPath }, { spawnProcess }),
      ).rejects.toThrow("output already exists");
    }
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("never stages output inside the VPK directory", async () => {
    const fixture = await extractionFixture();
    const spawnProcess = source2ViewerMock();
    await expect(
      extractVpkAssets(
        {
          ...fixture.config,
          outputPath: join(dirname(fixture.config.vpkPath), "asset-output"),
        },
        { spawnProcess },
      ),
    ).rejects.toThrow("outside the source VPK directory");
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("removes staging output and leaves no final directory after a failed extraction", async () => {
    const fixture = await extractionFixture();
    const spawnProcess = source2ViewerMock({ extractionExitCode: 23 });

    await expect(
      extractVpkAssets(fixture.config, { spawnProcess }),
    ).rejects.toThrow("Source2Viewer-CLI exited 23.");
    await expect(access(fixture.config.outputPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(
      (await readdir(dirname(fixture.config.outputPath))).filter((name) =>
        name.startsWith(".assets-6918.staging-"),
      ),
    ).toEqual([]);
  });

  it("rejects empty successful exports and invalid manifest provenance", async () => {
    const fixture = await extractionFixture();
    await expect(
      extractVpkAssets(fixture.config, {
        spawnProcess: source2ViewerMock({ writeExtractedFile: false }),
      }),
    ).rejects.toThrow("without extracting any asset files");

    const source2Viewer = {
      version: "fixture",
      arguments: buildSource2ViewerArgs({
        vpkPath: "/game/dota/pak01_dir.vpk",
        outputPath: "/cache/.assets.staging-fixture",
        threads: 1,
      }),
      filters: [...SOURCE2VIEWER_VPK_PATH_FILTERS],
      extensions: ["vtex_c"],
      textureDecodeFlags: "auto",
      threads: 1,
    };
    const manifest = {
      schema: VALVE_ASSET_EXTRACTION_SCHEMA,
      schemaVersion: VALVE_ASSET_EXTRACTION_SCHEMA_VERSION,
      clientVersion: "6918",
      extractedAt: "2026-08-31T01:23:45.000Z",
      vpk: { byteSize: 3, sha256: "a".repeat(64) },
      source2Viewer,
      extractedFileCount: 1,
    };
    expect(() =>
      validateValveAssetExtractionManifest({
        ...manifest,
        source2Viewer: {
          ...source2Viewer,
          filters: ["panorama/images/not-allowed/"],
        },
      }),
    ).toThrow("filters do not match");
  });
});

async function extractionFixture(): Promise<{
  config: VpkAssetExtractionConfig;
  vpkBytes: Buffer;
}> {
  const root = await mkdtemp(join(tmpdir(), "medota2-vpk-extract-"));
  temporaryRoots.push(root);
  const vpkPath = join(root, "game/dota/pak01_dir.vpk");
  const cliPath = join(root, "tools/Source2Viewer-CLI");
  await mkdir(dirname(vpkPath), { recursive: true });
  await mkdir(dirname(cliPath), { recursive: true });
  await mkdir(join(root, "cache/valve-assets"), { recursive: true });
  const vpkBytes = Buffer.from("fixture-vpk-bytes");
  await writeFile(vpkPath, vpkBytes);
  await writeFile(cliPath, "fixture-cli");
  return {
    config: {
      cliPath,
      clientVersion: "6918",
      outputPath: join(root, "cache/valve-assets/assets-6918"),
      threads: 4,
      vpkPath,
    },
    vpkBytes,
  };
}

function source2ViewerMock(
  options: {
    extractionExitCode?: number;
    version?: string;
    writeExtractedFile?: boolean;
  } = {},
) {
  const spawnProcess = vi.fn((_command: string, args: readonly string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough | null;
      stderr: PassThrough | null;
    };
    if (args[0] === "--version") {
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      queueMicrotask(() => {
        child.stdout?.end(
          `${options.version ?? "ValveResourceFormat 12.3.4"}\n`,
        );
        child.stderr?.end();
        child.emit("close", 0, null);
      });
      return child;
    }

    child.stdout = null;
    child.stderr = null;
    const outputIndex = args.indexOf("--output");
    const outputPath = args[outputIndex + 1];
    queueMicrotask(() => {
      void (async () => {
        if (options.writeExtractedFile !== false) {
          const extractedPath = join(
            outputPath,
            "panorama/images/spellicons/fixture_png.png",
          );
          await mkdir(dirname(extractedPath), { recursive: true });
          await writeFile(extractedPath, "decoded-image");
        }
        child.emit("close", options.extractionExitCode ?? 0, null);
      })().catch((error) => child.emit("error", error));
    });
    return child;
  }) as unknown as ReturnType<typeof vi.fn> & SpawnSource2Viewer;
  return spawnProcess;
}
