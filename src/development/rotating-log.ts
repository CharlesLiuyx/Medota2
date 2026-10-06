import { createReadStream } from "node:fs";
import { lstat, open, rename, rm, type FileHandle } from "node:fs/promises";
import { Writable } from "node:stream";
import { managedStoragePath, type StoragePolicy } from "./storage";

/** The supervisor is the only writer; children pipe output through this stream. */
export class RotatingLog extends Writable {
  private file?: FileHandle;
  private bytes = 0;
  private constructor(
    private root: string,
    private policy: StoragePolicy,
  ) {
    super();
  }
  static async create(
    root: string,
    policy: StoragePolicy,
  ): Promise<RotatingLog> {
    const writer = new RotatingLog(root, policy);
    try {
      await writer.initialize();
    } catch (error) {
      await writer.file?.close();
      writer.file = undefined;
      throw error;
    }
    return writer;
  }
  private async path(suffix = ""): Promise<string> {
    const path = await managedStoragePath(
      this.root,
      `.medota2/development/server.log${suffix}`,
    );
    const info = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info && (!info.isFile() || info.nlink > 1))
      throw new Error("Workbench log must be an unlinked regular file.");
    return path;
  }
  private async initialize(): Promise<void> {
    const previous = await this.path(".import");
    if (
      await lstat(previous)
        .then(() => true)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        })
    )
      throw new Error(
        "Interrupted log import exists; inspect server.log.import before restarting.",
      );
    for (let i = 1; i <= 10; i++) {
      const archive = await this.path(`.${i}`);
      const info = await lstat(archive).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        },
      );
      if (
        info &&
        (i > this.policy.logArchives || info.size > this.policy.logMaxBytes)
      )
        await rm(archive);
    }
    const path = await this.path();
    this.file = await open(path, "a", 0o600);
    this.bytes = (await this.file.stat()).size;
    if (this.bytes > this.policy.logMaxBytes) {
      // Import the old append-only log through the same bounded stream.
      await this.file.close();
      this.file = undefined;
      await rename(path, previous);
      this.file = await open(path, "a", 0o600);
      this.bytes = 0;
      for await (const chunk of createReadStream(previous))
        await this.append(chunk as Buffer);
      await rm(previous);
    }
  }
  private async rotate(): Promise<void> {
    await this.file?.close();
    this.file = undefined;
    await rm(await this.path(`.${this.policy.logArchives}`), { force: true });
    for (let i = this.policy.logArchives - 1; i >= 1; i--) {
      const from = await this.path(`.${i}`),
        to = await this.path(`.${i + 1}`);
      await rename(from, to).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    await rename(await this.path(), await this.path(".1"));
    this.file = await open(await this.path(), "a", 0o600);
    this.bytes = 0;
  }
  private async append(chunk: Buffer): Promise<void> {
    let offset = 0;
    while (offset < chunk.length) {
      if (this.bytes >= this.policy.logMaxBytes) await this.rotate();
      const piece = chunk.subarray(
        offset,
        offset + this.policy.logMaxBytes - this.bytes,
      );
      await this.file!.writeFile(piece);
      this.bytes += piece.length;
      offset += piece.length;
    }
  }
  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.append(chunk).then(() => callback(), callback);
  }
  override _final(callback: (error?: Error | null) => void): void {
    const file = this.file;
    this.file = undefined;
    (file?.close() ?? Promise.resolve()).then(() => callback(), callback);
  }
  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void,
  ): void {
    const file = this.file;
    this.file = undefined;
    (file?.close() ?? Promise.resolve()).then(() => callback(error), callback);
  }
}
