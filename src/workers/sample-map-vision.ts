import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { argument, sha256 } from "@/importers/dota-map/files";
import { readVisionScene } from "@/server/map/vision";
import {
  createVisionSolver,
  sampleVision,
  DEFAULT_VISION_OPTIONS,
  VISION_CELL_CODES,
} from "@/domain/map/vision";

async function main() {
  const args = process.argv.slice(2);
  const root = resolve(argument(args, "input"));
  const output = resolve(argument(args, "output"));
  const offset = relative(root, output);
  if (!offset || (!isAbsolute(offset) && !offset.startsWith("..")))
    throw new Error("Output must be outside the immutable dataset");
  const source = {
    id: "sample",
    x: Number(argument(args, "x")),
    y: Number(argument(args, "y")),
    radius: Number(argument(args, "radius")),
  };
  const data = await readVisionScene(root);
  const solver = createVisionSolver(data.scene, [source]);
  const bounds = {
    minX: Math.max(data.scene.bounds.minX, source.x - source.radius),
    maxX: Math.min(data.scene.bounds.maxX, source.x + source.radius),
    minY: Math.max(data.scene.bounds.minY, source.y - source.radius),
    maxY: Math.min(data.scene.bounds.maxY, source.y + source.radius),
  };
  const sample = sampleVision(solver, bounds);
  const counts = Object.fromEntries(
    Object.entries(VISION_CELL_CODES).map(([name, code]) => [
      name,
      sample.cells.reduce((sum, c) => sum + Number(c === code), 0),
    ]),
  );
  const nearbyTrees = data.scene.trees.filter(
    (t) => Math.hypot(t.x - source.x, t.y - source.y) < source.radius,
  );
  const withoutTrees = sampleVision(
    createVisionSolver(data.scene, [source], {
      removedTreeIds: nearbyTrees.map((t) => t.id),
    }),
    bounds,
  );
  const revealedAfterRemoval = withoutTrees.cells.reduce(
    (n, c, i) => n + Number(c === 1 && sample.cells[i] !== 1),
    0,
  );
  const scale =
    720 / Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  const x = (world: number) => 30 + (world - bounds.minX) * scale;
  const y = (world: number) => 90 + (bounds.maxY - world) * scale;
  const colors = ["#172131", "#45bc95", "#354354", "#ba8844"];
  const rectangles = Array.from(sample.cells, (code, i) => {
    const wx = bounds.minX + (i % sample.width) * sample.cell;
    const wy = bounds.minY + Math.floor(i / sample.width) * sample.cell;
    const w = Math.min(sample.cell, bounds.maxX - wx),
      h = Math.min(sample.cell, bounds.maxY - wy);
    return `<rect x="${x(wx)}" y="${y(wy + h)}" width="${w * scale}" height="${h * scale}" fill="${colors[code]}"/>`;
  }).join("");
  const trees = nearbyTrees
    .map(
      (t) =>
        `<circle cx="${x(t.x)}" cy="${y(t.y)}" r="${64 * scale}" fill="none" stroke="#92c755" stroke-width="1"/>`,
    )
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="780" height="850" viewBox="0 0 780 850"><rect width="780" height="850" fill="#101722"/><g fill="#eee" font-family="sans-serif"><text x="30" y="30" font-size="22">Approximate ground vision · ${data.identity.client_version ?? "unknown"}</text><text x="30" y="54" font-size="13">Green: visible | slate: blocked | amber: unknown | dark: outside radius</text><text x="30" y="75" font-size="12">64-unit samples · trees + coarse height · no engine verification</text></g>${rectangles}${trees}<circle cx="${x(source.x)}" cy="${y(source.y)}" r="6" fill="#fff" stroke="#000"/><text x="30" y="835" fill="#eee" font-family="sans-serif" font-size="12">Source (${source.x}, ${source.y}), R=${source.radius}; removing ${nearbyTrees.length} trees reveals ${revealedAfterRemoval} cells</text></svg>`;
  const report = {
    ...data.identity,
    codeCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    codeFiles: await Promise.all(
      [
        "src/domain/map/vision.ts",
        "src/server/map/vision.ts",
        "src/workers/sample-map-vision.ts",
      ].map(async (path) => ({ path, sha256: sha256(await readFile(path)) })),
    ),
    algorithm: sample.algorithm,
    sources: [source],
    options: DEFAULT_VISION_OPTIONS,
    counts,
    removedTreeCount: nearbyTrees.length,
    revealedAfterRemoval,
    limitations: data.limitations,
    reproduction: {
      command: "pnpm exec tsx src/workers/sample-map-vision.ts",
      arguments: args,
    },
  };
  // Nonrecursive creation intentionally rejects an existing output directory.
  await mkdir(output);
  await writeFile(resolve(output, "scene.json"), JSON.stringify(data));
  await writeFile(
    resolve(output, "samples.json"),
    JSON.stringify({
      ...sample,
      cells: Array.from(sample.cells),
      codes: VISION_CELL_CODES,
    }),
  );
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  await writeFile(resolve(output, "preview.svg"), svg);
  console.log(JSON.stringify({ output, counts, revealedAfterRemoval }));
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
