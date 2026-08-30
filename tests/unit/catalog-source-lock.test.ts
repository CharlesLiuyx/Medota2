import { describe, expect, it } from "vitest";
import type { CatalogSourceLock } from "@/importers/catalog-source-lock";
import { verifySnapshotAgainstLock } from "@/importers/catalog-source-lock";
import {
  CATALOG_SELECTOR_VERSION,
  VPK_SOURCE_REPOSITORY,
} from "@/importers/dota-vpk/constants";
import { sha256 } from "@/lib/hash";

const files = [
  { path: "b.txt", sha256: "b".repeat(64), sizeBytes: 2 },
  { path: "a.txt", sha256: "a".repeat(64), sizeBytes: 1 },
];
const manifest = [...files]
  .sort((left, right) =>
    Buffer.from(left.path).compare(Buffer.from(right.path)),
  )
  .map((file) => `${file.path}\t${file.sha256}\t${file.sizeBytes}\n`)
  .join("");

const lock: CatalogSourceLock = {
  version: 1,
  sourceRepository: VPK_SOURCE_REPOSITORY,
  remoteUrl: "https://example.test/source.git",
  commit: "1".repeat(40),
  selectorVersion: CATALOG_SELECTOR_VERSION,
  selectorManifestSha256: "2".repeat(64),
  manifestSha256: sha256(Buffer.from(manifest)),
  clientVersion: "6918",
  sourceRevision: "10949923",
  createdAt: "2026-08-31T00:00:00.000Z",
  files,
};

describe("catalog source lock", () => {
  it("accepts the exact snapshot independently of file iteration order", () => {
    expect(() =>
      verifySnapshotAgainstLock(lock, {
        commit: lock.commit,
        manifestSha256: lock.manifestSha256,
        files: [...lock.files].reverse(),
      }),
    ).not.toThrow();
  });

  it("rejects a blob checksum mismatch even when commit and manifest are claimed", () => {
    expect(() =>
      verifySnapshotAgainstLock(lock, {
        commit: lock.commit,
        manifestSha256: lock.manifestSha256,
        files: lock.files.map((file, index) =>
          index === 0 ? { ...file, sha256: "f".repeat(64) } : file,
        ),
      }),
    ).toThrow("Source file list or blob checksums differ from the lock");
  });
});
