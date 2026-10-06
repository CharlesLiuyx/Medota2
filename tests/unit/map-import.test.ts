import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import { expect, it } from "vitest";
import { mapPackageSchema } from "@/domain/map/schema";
import { sha256 } from "@/importers/dota-map/files";
const exec = promisify(execFile);
it("imports a checksummed native-size fixture atomically and rejects wrong texture, stale bytes and overwrite", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "medota-map-"));
  try {
    const input = resolve(root, "input"),
      output = resolve(root, "output");
    await mkdir(resolve(input, "textures/materials/overviews"), {
      recursive: true,
    });
    await mkdir(resolve(input, "entities"));
    const texturePath = "textures/materials/overviews/test.png";
    const image = await sharp({
      create: { width: 1024, height: 1024, channels: 3, background: "#162b23" },
    })
      .png()
      .toBuffer();
    const fixture: Record<string, string | Buffer> = {
      "steam.inf": "ClientVersion=fixture\nSourceRevision=fixture\n",
      "overview.txt":
        "dota { material materials/overviews/dota.vmat pos_x -9472 pos_y 9472 scale 18.5 }",
      "textures/materials/overviews/dota.vmat":
        '{ TextureColor = resource:"materials/overviews/test.vtex" }',
      [texturePath]: image,
      "textures/materials/overviews/old.png": image,
      "entities/default.vents":
        '====0====\nclassname "npc_dota_fort"\norigin "-6000 -6000 128"\nteamnumber 2\n====1====\nclassname "npc_dota_fort"\norigin "6000 6000 128"\nteamnumber 3\n',
    };
    for (const [path, bytes] of Object.entries(fixture))
      await writeFile(resolve(input, path), bytes);
    await writeFile(
      resolve(input, "extraction.json"),
      JSON.stringify({
        schemaVersion: 1,
        source_repository: "synthetic-fixture",
        source_commit: "f".repeat(40),
        client_version: "fixture",
        files: Object.entries(fixture).map(([path, bytes]) => ({
          path,
          sha256: sha256(bytes),
        })),
      }),
    );
    const run = (texture = texturePath) =>
      exec(
        process.execPath,
        [
          "--import",
          "tsx",
          "src/workers/import-map.ts",
          "--input",
          input,
          "--output",
          output,
          "--texture",
          texture,
          "--entities",
          "entities/default.vents",
        ],
        { timeout: 15000 },
      );
    await expect(run("textures/materials/overviews/old.png")).rejects.toThrow(
      "does not match",
    );
    await run();
    const map = mapPackageSchema.parse(
      JSON.parse(await readFile(resolve(output, "map.json"), "utf8")),
    );
    expect(map.points).toHaveLength(2);
    expect(sha256(await readFile(resolve(output, "overview.webp")))).toBe(
      map.image.sha256,
    );
    expect(map.image.width).toBe(1024);
    expect(map.coverage.navigation).toBe(false);
    await expect(run()).rejects.toThrow("already exists");
    await rm(output, { recursive: true });
    await writeFile(resolve(input, "entities/default.vents"), "changed");
    await expect(run()).rejects.toThrow("checksum mismatch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
