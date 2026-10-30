import {
  closeSync,
  fstatSync,
  open,
  readSync,
  type BigIntStats,
} from 'node:fs';
import {
  requireSourceRange,
  type ByteSource,
  type SourceCacheStats,
} from '../core/files/byte-source';
import type { ReaderIOStats } from './types';

/** Node-only positioned input, with one bounded, reusable read-ahead window. */
export class FileByteSource implements ByteSource {
  readonly cache = {
    clear: (): void => this.clearCache(),
    setLimit: (bytes: number): void => this.setCacheLimit(bytes),
    setReadAhead: (enabled: boolean): void => {
      if (typeof enabled !== 'boolean')
        throw new TypeError('readAhead must be a boolean');
      this.clearCache();
      this.readAhead = enabled;
    },
    getStats: (): SourceCacheStats => ({
      entries: this.window ? 1 : 0,
      // Charge allocated capacity, not just the valid part of the window.
      bytes: this.window?.length ?? 0,
      hits: this.hits,
      misses: this.misses,
      maxBytes: this.maxCacheBytes,
    }),
  };
  readonly size: number;
  private fd?: number;
  private readonly snapshot: BigIntStats;
  private readAhead = true;
  private window?: Buffer;
  private windowStart = 0;
  private windowLength = 0;
  private lastEnd = -1;
  private sequentialReads = 0;
  private ahead = 0;
  private maxCacheBytes = 0;
  private hits = 0;
  private misses = 0;
  private readCalls = 0;
  private bytesRead = 0;

  private constructor(fd: number) {
    this.fd = fd;
    try {
      const stat = fstatSync(fd, { bigint: true });
      if (!stat.isFile()) throw new Error('CHM input must be a regular file');
      if (stat.size > BigInt(Number.MAX_SAFE_INTEGER) || stat.size < 0n)
        throw new Error('CHM input size exceeds the safe integer range');
      this.snapshot = stat;
      this.size = Number(stat.size);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  static async open(path: string): Promise<FileByteSource> {
    const fd = await new Promise<number>((resolve, reject) => {
      open(path, 'r', (error, descriptor) => {
        if (error) reject(error);
        else resolve(descriptor);
      });
    });
    return new FileByteSource(fd);
  }

  /** Input is immutable for this source's lifetime, including cache hits. */
  validate(): void {
    const fd = this.assertOpen();
    try {
      const stat = fstatSync(fd, { bigint: true });
      if (
        stat.size !== this.snapshot.size ||
        stat.mtimeNs !== this.snapshot.mtimeNs ||
        stat.ctimeNs !== this.snapshot.ctimeNs ||
        stat.dev !== this.snapshot.dev ||
        stat.ino !== this.snapshot.ino
      )
        throw new Error(
          'CHM file input changed since opening; reopen the archive',
        );
    } catch (error) {
      try {
        this.close();
      } catch {
        // Preserve the validation error even if the descriptor was closed elsewhere.
      }
      throw error;
    }
  }

  read(offset: number, length: number): Buffer {
    this.validate();
    requireSourceRange(this, offset, length, 'CHM file input');
    if (length === 0) return Buffer.alloc(0);
    if (offset === this.lastEnd) this.sequentialReads++;
    else {
      this.sequentialReads = 0;
      this.ahead = 0;
    }
    this.lastEnd = offset + length;
    if (
      this.window &&
      offset >= this.windowStart &&
      offset + length <= this.windowStart + this.windowLength
    ) {
      this.hits++;
      const start = offset - this.windowStart;
      return Buffer.from(this.window.subarray(start, start + length));
    }
    this.misses++;
    if (length > this.maxCacheBytes) {
      const result = Buffer.allocUnsafe(length);
      this.readInto(offset, result);
      return result;
    }
    // Two adjacent transitions are evidence of sequential access. Random reads
    // fetch exactly their requested bytes; initialization has a zero cache limit.
    this.ahead =
      this.readAhead && this.sequentialReads >= 2
        ? Math.min(
            this.maxCacheBytes,
            Math.max(4096, length * 2, this.ahead * 2),
          )
        : length;
    this.window ??= Buffer.allocUnsafe(this.maxCacheBytes);
    this.windowLength = 0; // A failed/short read must never expose stale bytes.
    const count = Math.min(this.ahead, this.size - offset);
    this.readInto(offset, this.window.subarray(0, count));
    this.windowStart = offset;
    this.windowLength = count;
    // Never lend the reusable I/O window to a decoder, cache or caller.
    return Buffer.from(this.window.subarray(0, length));
  }

  getIOStats(): ReaderIOStats {
    return {
      readCalls: this.readCalls,
      bytesRead: this.bytesRead,
      size: this.size,
    };
  }

  close(): void {
    const fd = this.fd;
    this.fd = undefined;
    this.clearCache();
    if (fd !== undefined) closeSync(fd);
  }

  private assertOpen(): number {
    if (this.fd === undefined) throw new Error('CHM file input is closed');
    return this.fd;
  }

  private readInto(offset: number, target: Buffer): void {
    const fd = this.assertOpen();
    let position = 0;
    while (position < target.length) {
      this.readCalls++;
      const count = readSync(
        fd,
        target,
        position,
        target.length - position,
        offset + position,
      );
      this.bytesRead += count;
      if (count === 0)
        throw new Error(
          `CHM file input: unexpected EOF at ${offset + position}`,
        );
      position += count;
    }
    this.validate();
  }

  private clearCache(): void {
    this.window = undefined;
    this.windowLength = 0;
    this.lastEnd = -1;
    this.sequentialReads = 0;
    this.ahead = 0;
    this.hits = this.misses = 0;
  }

  private setCacheLimit(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new RangeError(
        'Source cache limit must be a non-negative safe integer',
      );
    this.clearCache();
    this.maxCacheBytes = bytes;
  }
}
