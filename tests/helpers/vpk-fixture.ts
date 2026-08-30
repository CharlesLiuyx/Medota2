import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { VPK_SOURCE_PATHS } from "@/importers/dota-vpk/constants";
import type { CheckedSourceFile } from "@/importers/git-checkout";
import { sha256 } from "@/lib/hash";

export async function loadVpkFixture(): Promise<CheckedSourceFile[]> {
  const root = resolve(process.cwd(), "tests/fixtures/vpk");
  return Promise.all(
    VPK_SOURCE_PATHS.map(async (path) => {
      const bytes = await readFile(resolve(root, path));
      const hasBom = bytes
        .subarray(0, 3)
        .equals(Buffer.from([0xef, 0xbb, 0xbf]));
      const payload = hasBom ? bytes.subarray(3) : bytes;
      return {
        path,
        bytes,
        text: new TextDecoder().decode(payload).replace(/\r\n?/gu, "\n"),
        sha256: sha256(bytes),
        sizeBytes: bytes.byteLength,
        encoding: hasBom
          ? "utf-8-bom"
          : payload.every((byte) => byte < 0x80)
            ? "ascii"
            : "utf-8",
      } satisfies CheckedSourceFile;
    }),
  );
}

export async function mutateVpkFixture(
  path: string,
  mutate: (text: string) => string,
): Promise<CheckedSourceFile[]> {
  const files = await loadVpkFixture();
  return files.map((file) =>
    file.path === path ? { ...file, text: mutate(file.text) } : file,
  );
}
