import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
export const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export async function fileSha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export async function insideFile(root: string, path: string) {
  if (isAbsolute(path) || path.split(/[\\/]/).includes(".."))
    throw new Error("Expected a relative path inside extraction");
  const [base, file] = await Promise.all([
    realpath(root),
    realpath(resolve(root, path)),
  ]);
  if (!file.startsWith(base + sep) || !(await lstat(file)).isFile())
    throw new Error("Input escapes extraction directory or is not a file");
  return file;
}
export async function listFiles(
  root: string,
  directory = root,
): Promise<string[]> {
  const found: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isSymbolicLink())
      throw new Error("Symlinks are not allowed in map extraction");
    if (item.isDirectory()) found.push(...(await listFiles(root, path)));
    else if (item.isFile())
      found.push(relative(root, path).split(sep).join("/"));
  }
  return found.sort();
}
export function argument(argv: string[], key: string) {
  const index = argv.indexOf(`--${key}`),
    value = index < 0 ? null : argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`--${key} <value> is required`);
  return value;
}
export async function checkedFile(
  root: string,
  path: string,
  files: { path: string; sha256: string }[],
) {
  const expected = files.find((f) => f.path === path);
  if (!expected) throw new Error(`File not recorded in extraction: ${path}`);
  const bytes = await readFile(await insideFile(root, path));
  if (sha256(bytes) !== expected.sha256)
    throw new Error(`Extraction checksum mismatch: ${path}`);
  return bytes;
}
