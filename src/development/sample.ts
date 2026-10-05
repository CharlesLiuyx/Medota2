import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { parseHeroDataset } from "@/importers/dota-vpk/hero-adapter";
import { parseAbilityDataset } from "@/importers/dota-vpk/ability-adapter";
import { CATALOG_STATIC_SOURCE_PATHS } from "@/importers/dota-vpk/constants";
import type { CheckedSourceFile } from "@/importers/git-checkout";
import { sha256 } from "@/lib/hash";

export const sampleInputs = [
  "src/importers",
  "src/domain",
  "src/lib",
  "src/development",
  "src/workers/run-development-sample.ts",
  "tests/fixtures/vpk",
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
];
export interface SampleResult {
  schemaVersion: 1;
  inputVersion: string;
  durationMs: number;
  peakMemoryMb: number;
  inputBytes: number;
  heroes: Array<{ id: number; name: string; movementSpeed: string }>;
  abilities: number;
  issues: number;
}

/** Uses the production parsers; the default input is the repository's small, known fixture. */
export async function runCatalogSample(
  root = resolve("tests/fixtures/vpk"),
): Promise<SampleResult> {
  const started = performance.now();
  const heroDirectory = resolve(root, "scripts/npc/heroes");
  const paths = [
    ...CATALOG_STATIC_SOURCE_PATHS,
    ...(await readdir(heroDirectory))
      .filter((name) => name.endsWith(".txt"))
      .map((name) =>
        relative(root, resolve(heroDirectory, name)).split("\\").join("/"),
      ),
  ];
  const files: CheckedSourceFile[] = await Promise.all(
    paths.map(async (path) => {
      const bytes = await readFile(resolve(root, path));
      const hasBom = bytes
        .subarray(0, 3)
        .equals(Buffer.from([0xef, 0xbb, 0xbf]));
      const payload = hasBom ? bytes.subarray(3) : bytes;
      return {
        path,
        bytes,
        text: new TextDecoder().decode(payload).replace(/\r\n?/g, "\n"),
        sha256: sha256(bytes),
        sizeBytes: bytes.length,
        encoding: hasBom
          ? "utf-8-bom"
          : payload.every((b) => b < 0x80)
            ? "ascii"
            : "utf-8",
      };
    }),
  );
  const heroes = parseHeroDataset(files);
  const abilities = parseAbilityDataset(files, heroes.heroes);
  return {
    schemaVersion: 1,
    inputVersion: sha256(
      files
        .map((file) => `${file.path}:${file.sha256}`)
        .sort()
        .join("\n"),
    ),
    durationMs: Math.round((performance.now() - started) * 10) / 10,
    peakMemoryMb: Math.round(process.resourceUsage().maxRSS / 1024),
    inputBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
    heroes: heroes.heroes.map((hero) => ({
      id: hero.heroId,
      name: hero.internalName,
      movementSpeed: hero.movementSpeed,
    })),
    abilities: abilities.abilities.length,
    issues: heroes.issues.length + abilities.issues.length,
  };
}
