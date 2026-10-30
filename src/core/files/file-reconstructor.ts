import type { DirectoryEntry, CHMFile, ParsedCHM } from '../types';
import type { BitReader } from '../../utils/io/bit-reader';
import { LZXDecoder } from '../lzx/lzx-decoder';
import { CHMFileManager } from './file-manager';
import { checkedEnd } from '../headers/binary';
import {
  asByteSource,
  requireSourceRange,
  type ByteSource,
} from './byte-source';

export interface ReconstructorOptions {
  maxCacheBytes?: number;
  maxOutputBytes?: number;
}

/** Reconstruct only the reset groups intersecting a requested byte range. */
export class FileReconstructor {
  private readonly fileManager: CHMFileManager;
  private readonly cache = new Map<number, Buffer>();
  private cacheBytes = 0;
  private hits = 0;
  private misses = 0;
  private maxCacheBytes: number;
  private readonly maxOutputBytes: number;

  constructor(
    private readonly parsedCHM: ParsedCHM,
    options: ReconstructorOptions = {},
  ) {
    this.fileManager = new CHMFileManager(parsedCHM);
    this.maxOutputBytes = options.maxOutputBytes ?? LZXDecoder.MAX_OUTPUT_SIZE;
    if (!Number.isSafeInteger(this.maxOutputBytes) || this.maxOutputBytes < 0)
      throw new Error('maxOutputBytes must be a non-negative safe integer');
    this.maxCacheBytes = 0;
    this.setCacheLimit(options.maxCacheBytes ?? 8 * 1024 * 1024);
  }

  reconstructFile(fileName: string, reader: BitReader | ByteSource): CHMFile {
    const entry = this.requireEntry(fileName);
    const data = this.reconstructRange(fileName, reader);
    return {
      name: entry.name,
      data,
      isCompressed: entry.section === 1,
      originalSize: entry.length,
      compressedSize: entry.section === 1 ? null : entry.length,
    };
  }

  reconstructRange(
    fileName: string,
    reader: BitReader | ByteSource,
    start = 0,
    end?: number,
  ): Buffer {
    asByteSource(reader).validate?.();
    const entry = this.requireEntry(fileName);
    const limit = end ?? entry.length;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(limit) ||
      start < 0 ||
      limit < start ||
      limit > entry.length
    ) {
      throw new RangeError(
        `Invalid file range [${start}, ${limit}) for ${entry.name}`,
      );
    }
    const length = limit - start;
    if (length > this.maxOutputBytes)
      throw new RangeError(
        'Requested output exceeds maxOutputBytes; use a range or stream',
      );
    if (length === 0) return Buffer.alloc(0);
    if (entry.section === 0) {
      const itsf = this.parsedCHM.header.itsf;
      const base =
        itsf.version === 3
          ? itsf.unknown4
          : checkedEnd(
              itsf.directoryOffset,
              itsf.directoryLength,
              'ITSF data base',
            );
      const absolute = checkedEnd(
        checkedEnd(base, entry.offset, entry.name),
        start,
        entry.name,
      );
      const source = asByteSource(reader);
      requireSourceRange(source, absolute, length, entry.name);
      return Buffer.from(source.read(absolute, length));
    }
    if (entry.section !== 1)
      throw new Error(`Unsupported CHM section: ${entry.section}`);
    const table = this.parsedCHM.resetTable;
    const frameSize = table.blockSize;
    const resetBytes = this.parsedCHM.header.lzxc.resetInterval;
    if (
      frameSize !== LZXDecoder.FRAME_SIZE ||
      !Number.isSafeInteger(resetBytes) ||
      resetBytes <= 0 ||
      resetBytes % frameSize !== 0 ||
      resetBytes > LZXDecoder.MAX_OUTPUT_SIZE
    )
      throw new Error('Invalid or excessively large LZX reset interval');
    const absoluteStart = checkedEnd(entry.offset, start, entry.name);
    const absoluteEnd = checkedEnd(entry.offset, limit, entry.name);
    if (absoluteEnd > table.uncompressedLength)
      throw new Error(`File range exceeds LZX stream: ${entry.name}`);
    const output = Buffer.alloc(length);
    let written = 0;
    for (
      let group = Math.floor(absoluteStart / resetBytes) * resetBytes;
      group < absoluteEnd;
      group += resetBytes
    ) {
      const groupSize = Math.min(resetBytes, table.uncompressedLength - group);
      if (groupSize > this.maxCacheBytes) {
        // A group we cannot retain has no reuse benefit. Decode its necessary
        // history lazily, without fetching the unused suffix or materializing
        // the prefix before the requested range.
        this.misses++;
        const from = Math.max(absoluteStart, group) - entry.offset;
        const to = Math.min(absoluteEnd, group + groupSize) - entry.offset;
        for (const chunk of this.iterateFileChunks(
          fileName,
          reader,
          64 * 1024,
          from,
          to,
        )) {
          chunk.copy(output, written);
          written += chunk.length;
        }
        continue;
      }
      const data = this.readResetGroup(group, reader);
      const from = Math.max(absoluteStart, group) - group;
      const to = Math.min(absoluteEnd, group + data.length) - group;
      if (to <= from)
        throw new Error('LZX reset group does not cover requested bytes');
      data.copy(output, written, from, to);
      written += to - from;
    }
    if (written !== length) throw new Error('Incomplete file reconstruction');
    return output;
  }

  /**
   * Sequential, cache-independent reconstruction of a file-relative [start, end)
   * range (default: the whole file). Each physical frame from the nearest reset
   * before start through the range end is decoded once, including any prefix
   * needed for history and the last frame's physical Intel E8 tail. Returned
   * buffers are owned copies, at most min(chunkSize, maxOutputBytes) bytes.
   * Validation/I/O is lazy; callers must exhaust or return() the generator to
   * release its decoder and source references. The reader cursor is unchanged.
   */
  *iterateFileChunks(
    fileName: string,
    reader: BitReader | ByteSource,
    chunkSize: number,
    start = 0,
    end?: number,
  ): Generator<Buffer> {
    if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0)
      throw new RangeError('chunkSize must be a positive safe integer');
    const source = asByteSource(reader);
    source.validate?.();
    const entry = this.requireEntry(fileName);
    const until = end ?? entry.length;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(until) ||
      start < 0 ||
      until < start ||
      until > entry.length
    )
      throw new RangeError(
        `Invalid file range [${start}, ${until}) for ${entry.name}`,
      );
    const length = until - start;
    if (length === 0) return;
    if (entry.section !== 0 && entry.section !== 1)
      throw new Error(`Unsupported CHM section: ${entry.section}`);
    const absoluteStart = checkedEnd(entry.offset, start, entry.name);
    const absoluteEnd = checkedEnd(entry.offset, until, entry.name);
    if (this.maxOutputBytes === 0)
      throw new RangeError('Requested output exceeds maxOutputBytes');
    const limit = Math.min(chunkSize, this.maxOutputBytes);
    if (entry.section === 0) {
      const itsf = this.parsedCHM.header.itsf;
      const base =
        itsf.version === 3
          ? itsf.unknown4
          : checkedEnd(
              itsf.directoryOffset,
              itsf.directoryLength,
              'ITSF data base',
            );
      const absolute = checkedEnd(base, absoluteStart, entry.name);
      const source = asByteSource(reader);
      requireSourceRange(source, absolute, length, entry.name);
      for (let position = 0; position < length;) {
        const size = Math.min(limit, length - position);
        yield Buffer.from(source.read(absolute + position, size));
        position += size;
      }
      return;
    }
    const table = this.parsedCHM.resetTable;
    const frameSize = LZXDecoder.FRAME_SIZE;
    const resetBytes = this.parsedCHM.header.lzxc.resetInterval;
    if (
      table.blockSize !== frameSize ||
      !Number.isSafeInteger(resetBytes) ||
      resetBytes <= 0 ||
      resetBytes % frameSize !== 0
    )
      throw new Error('Invalid LZX reset interval or frame size');
    if (absoluteEnd > checkedEnd(table.uncompressedLength, 0, 'LZX stream'))
      throw new Error(`File range exceeds LZX stream: ${entry.name}`);
    const startFrame =
      (Math.floor(absoluteStart / resetBytes) * resetBytes) / frameSize;
    const endFrame = Math.ceil(absoluteEnd / frameSize);
    const compressed = this.iterateCompressedFrames(
      reader,
      startFrame,
      endFrame,
    );
    // Delegation keeps decoder/frame/buffer locals out of the caller's suspended
    // scope; completion or return() releases the entire buffering scope.
    yield* this.iterateDecodedChunks(
      new LZXDecoder(this.parsedCHM.header.lzxc).iterateFrames(
        compressed,
        absoluteEnd - startFrame * frameSize,
        startFrame,
        frameSize,
      ),
      source,
      absoluteStart - startFrame * frameSize,
      length,
      limit,
    );
  }

  private *iterateDecodedChunks(
    decoded: Generator<Buffer>,
    source: ByteSource,
    skip: number,
    remaining: number,
    limit: number,
  ): Generator<Buffer> {
    let chunk: Buffer | undefined;
    let filled = 0;
    // Transfer output in a synchronous scope so no `ready` buffer local survives
    // a yield/resume while the next chunk or frame is being allocated.
    const takeChunk = (): Buffer => {
      const ready = chunk!;
      chunk = undefined;
      filled = 0;
      return ready;
    };
    // for-of closes decoded on return(), throw() or a validation/copy failure.
    for (const frame of decoded) {
      let position = Math.min(skip, frame.length);
      skip -= position;
      while (position < frame.length) {
        chunk ??= Buffer.alloc(Math.min(limit, remaining));
        const count = Math.min(chunk.length - filled, frame.length - position);
        frame.copy(chunk, filled, position, position + count);
        filled += count;
        position += count;
        remaining -= count;
        if (filled === chunk.length) {
          source.validate?.();
          yield takeChunk();
        }
      }
    }
    if (remaining !== 0) throw new Error('Incomplete file reconstruction');
  }

  private *iterateCompressedFrames(
    reader: BitReader | ByteSource,
    start: number,
    end: number,
  ): Generator<Uint8Array> {
    for (let index = start; index < end; index++)
      yield this.readCompressedFrame(index, reader);
  }

  private readCompressedFrame(
    index: number,
    reader: BitReader | ByteSource,
  ): Uint8Array {
    const table = this.parsedCHM.resetTable;
    const offset = table.entries[index]?.compressedLength;
    const next =
      table.entries[index + 1]?.compressedLength ?? table.compressedLength;
    if (
      offset === undefined ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(next) ||
      offset < 0 ||
      next <= offset ||
      next > table.compressedLength
    )
      throw new Error(`Invalid LZX frame offsets at ${index}`);
    const absolute = checkedEnd(
      this.parsedCHM.contentOffset,
      offset,
      'LZX frame',
    );
    const source = asByteSource(reader);
    requireSourceRange(source, absolute, next - offset, 'LZX frame');
    return source.read(absolute, next - offset);
  }

  private readResetGroup(
    group: number,
    reader: BitReader | ByteSource,
  ): Buffer {
    const cached = this.cache.get(group);
    if (cached) {
      this.hits++;
      this.cache.delete(group);
      this.cache.set(group, cached);
      return cached;
    }
    this.misses++;
    const table = this.parsedCHM.resetTable;
    const size = Math.min(
      this.parsedCHM.header.lzxc.resetInterval,
      table.uncompressedLength - group,
    );
    if (size <= 0) throw new Error('LZX reset group is outside the stream');
    const startFrame = group / LZXDecoder.FRAME_SIZE;
    const frameCount = Math.ceil(size / LZXDecoder.FRAME_SIZE);
    const frames = this.iterateCompressedFrames(
      reader,
      startFrame,
      startFrame + frameCount,
    );
    // Decode the complete physical frames, not merely a file prefix: E8's
    // ten-byte tail exemption and dictionary state depend on the real frame end.
    const data = Buffer.alloc(size);
    let position = 0;
    for (const frame of new LZXDecoder(
      this.parsedCHM.header.lzxc,
    ).iterateFrames(frames, size, startFrame, LZXDecoder.FRAME_SIZE)) {
      frame.copy(data, position);
      position += frame.length;
    }
    if (position !== size) throw new Error('Incomplete LZX reset group');
    if (data.length <= this.maxCacheBytes) {
      this.cache.set(group, data);
      this.cacheBytes += data.length;
      this.evict();
    }
    return data;
  }

  reconstructFiles(
    fileNames: string[],
    reader: BitReader | ByteSource,
  ): Map<string, CHMFile> {
    return new Map(
      fileNames.map(name => [name, this.reconstructFile(name, reader)]),
    );
  }

  reconstructAllFiles(reader: BitReader | ByteSource): Map<string, CHMFile> {
    return this.reconstructFiles(this.fileManager.getFileList(), reader);
  }

  validateFile(file: CHMFile): boolean {
    return Buffer.isBuffer(file.data) && file.data.length === file.originalSize;
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheBytes = 0;
    this.hits = this.misses = 0;
  }

  setCacheLimit(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new RangeError('Cache limit must be a non-negative safe integer');
    this.maxCacheBytes = bytes;
    this.evict();
  }

  getCacheStats(): {
    entries: number;
    bytes: number;
    hits: number;
    misses: number;
    maxBytes: number;
  } {
    return {
      entries: this.cache.size,
      bytes: this.cacheBytes,
      hits: this.hits,
      misses: this.misses,
      maxBytes: this.maxCacheBytes,
    };
  }

  private evict(): void {
    while (this.cacheBytes > this.maxCacheBytes && this.cache.size > 0) {
      const key = this.cache.keys().next().value as number;
      this.cacheBytes -= this.cache.get(key)!.length;
      this.cache.delete(key);
    }
  }

  private requireEntry(name: string): DirectoryEntry {
    const entry = this.fileManager.findFileEntry(name);
    if (!entry) throw new Error(`文件未找到: ${name}`);
    return entry;
  }
}
