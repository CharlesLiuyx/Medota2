import { createHash } from "node:crypto";

export function sha256(input: Uint8Array | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error(
        "RFC 8785 canonical JSON cannot encode a non-finite number.",
      );
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`RFC 8785 canonical JSON cannot encode ${typeof value}.`);
}

export function canonicalJsonSha256(value: unknown): string {
  return sha256(Buffer.from(canonicalJson(value), "utf8"));
}
