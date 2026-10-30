import type {
  ParsedCHM,
  CHMDirectory,
  DirectoryEntry,
  LZXCHeader,
  ResetTable,
} from '../types';
import { BitReader } from '../../utils/io/bit-reader';
import { ITSFHeaderParser } from '../headers/itsf-header';
import { ITSPHeaderParser } from '../headers/itsp-header';
import { LZXCHeaderParser } from '../headers/lzxc-header';
import { checkedEnd } from '../headers/binary';
import {
  MemoryByteSource,
  requireSourceRange,
  type ByteSource,
} from '../files/byte-source';
import { DirectoryParser } from '../directory/directory-parser';
import { ResetTableProcessor } from '../lzx/reset-table';

const STORAGE = '::DataSpace/Storage/MSCompressed/';
const CONTENT = `${STORAGE}Content`;
const CONTROL = `${STORAGE}ControlData`;
const RESET = `${STORAGE}Transform/{7FC28940-9D31-11D0-9B27-00A0C91E9C7C}/InstanceData/ResetTable`;

export class CHMParser {
  /** Fixed per-ITSF-header allocation budget, for memory and random-access input. */
  static readonly MAX_HEADER_BYTES = 1024 * 1024;
  /** Fixed allocation budget for the complete ITSP/PMGL/PMGI directory. */
  static readonly MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;
  /** Per-stream allocation budget for ControlData and ResetTable, not Content. */
  static readonly MAX_METADATA_STREAM_BYTES = 16 * 1024 * 1024;

  private resetTableProcessor = new ResetTableProcessor();

  parse(reader: BitReader): ParsedCHM {
    reader.setPosition(0, 0);
    const parsed = this.parseSource(new MemoryByteSource(reader.buffer));
    reader.setPosition(
      checkedEnd(
        parsed.header.itsf.directoryOffset,
        parsed.header.itsf.directoryLength,
        'ITSF directory',
      ),
      0,
    );
    return parsed;
  }

  /** Reads only structural metadata; validates payload ranges without loading them. */
  parseSource(source: ByteSource): ParsedCHM {
    this.reset();
    const parsed = this.parseStructure(source);
    const resetEntry = this.findEntry(parsed.directory, RESET);
    let resetTable: ResetTable = {
      version: 2,
      blockCount: 0,
      entrySize: 8,
      tableOffset: 0x28,
      uncompressedLength: 0,
      compressedLength: 0,
      blockSize: 0x8000,
      entries: [],
    };
    if (resetEntry) {
      const base = this.dataOffset(parsed);
      resetTable = this.resetTableProcessor.parseResetTable(
        this.entryReader(source, base, resetEntry),
      );
      const content = this.findEntry(parsed.directory, CONTENT)!;
      if (resetTable.compressedLength !== content.length)
        throw new Error('ResetTable: compressed length does not match Content');
      for (const entry of parsed.directory.entries.values()) {
        if (
          entry.section === 1 &&
          checkedEnd(entry.offset, entry.length, entry.name) >
            resetTable.uncompressedLength
        ) {
          throw new Error(
            `Compressed entry outside uncompressed stream: ${entry.name}`,
          );
        }
      }
    }
    return { ...parsed, resetTable };
  }

  private parseStructure(source: ByteSource): Omit<ParsedCHM, 'resetTable'> {
    // Validate the fixed prefix before trusting its declared allocation size.
    const prefix = this.readMetadata(
      source,
      0,
      Math.min(12, source.size),
      CHMParser.MAX_HEADER_BYTES,
      'ITSF header',
    );
    if (prefix.length < 12)
      throw new Error('ITSF header: truncated or out of bounds');
    const version = prefix.readUInt32LE(4);
    if (
      prefix.toString('ascii', 0, 4) !== 'ITSF' ||
      (version !== 2 && version !== 3)
    )
      throw new Error('Invalid ITSF signature or version');
    const headerLength = prefix.readUInt32LE(8);
    const itsf = ITSFHeaderParser.parse(
      new BitReader(
        this.readMetadata(
          source,
          0,
          headerLength,
          CHMParser.MAX_HEADER_BYTES,
          'ITSF header',
        ),
      ),
    );
    requireSourceRange(
      source,
      itsf.unknown2,
      itsf.unknown3,
      'ITSF auxiliary header section 0',
    );
    requireSourceRange(
      source,
      itsf.directoryOffset,
      itsf.directoryLength,
      'ITSF directory',
    );
    const directoryEnd = checkedEnd(
      itsf.directoryOffset,
      itsf.directoryLength,
      'ITSF directory',
    );
    // v3 explicitly stores the data base, including a valid zero. Never replace
    // it with directoryEnd: some producers append the directory after content.
    const base = itsf.version === 3 ? itsf.unknown4 : directoryEnd;
    requireSourceRange(source, base, 0, 'ITSF data section');
    const directoryReader = new BitReader(
      this.readMetadata(
        source,
        itsf.directoryOffset,
        itsf.directoryLength,
        CHMParser.MAX_DIRECTORY_BYTES,
        'ITSF directory',
      ),
    );
    const itsp = ITSPHeaderParser.parse(directoryReader);
    const chunkBytes = itsf.directoryLength - itsp.headerLength;
    const numChunks = directoryReader.buffer.readUInt32LE(0x2c);
    if (chunkBytes !== numChunks * itsp.chunkSize)
      throw new Error('ITSP chunk count does not match directory length');
    const directory = DirectoryParser.parse(directoryReader, itsp, numChunks);
    if (!DirectoryParser.validate(directory))
      throw new Error('目录结构验证失败');

    for (const entry of directory.entries.values()) {
      if (entry.section === 0) {
        requireSourceRange(
          source,
          checkedEnd(base, entry.offset, entry.name),
          entry.length,
          entry.name,
        );
      }
    }
    const control = this.findEntry(directory, CONTROL);
    const content = this.findEntry(directory, CONTENT);
    const reset = this.findEntry(directory, RESET);
    const hasCompression =
      Boolean(control || content || reset) ||
      Array.from(directory.entries.values()).some(entry => entry.section === 1);
    // CHMHeader.lzxc is required by the existing API. An empty signature marks
    // absence; do not invent usable compression settings for section-0 files.
    let lzxc: LZXCHeader = {
      signature: '',
      version: 0,
      resetInterval: 0,
      windowSize: 0,
      cacheSize: 0,
      unknown: 0,
    };
    if (hasCompression) {
      if (!control || !content || !reset)
        throw new Error(
          '缺少压缩元数据: Content, ControlData and ResetTable are required',
        );
      for (const entry of [control, content, reset]) {
        if (entry.section !== 0)
          throw new Error(
            `Compression metadata must be in section 0: ${entry.name}`,
          );
      }
      lzxc = LZXCHeaderParser.parse(this.entryReader(source, base, control));
    }
    const contentOffset = content
      ? checkedEnd(base, content.offset, CONTENT)
      : base;
    return { header: { itsf, itsp, lzxc }, directory, contentOffset };
  }

  private dataOffset(parsed: Omit<ParsedCHM, 'resetTable'>): number {
    const itsf = parsed.header.itsf;
    return itsf.version === 3
      ? itsf.unknown4
      : checkedEnd(
          itsf.directoryOffset,
          itsf.directoryLength,
          'ITSF directory',
        );
  }

  private findEntry(
    directory: CHMDirectory,
    name: string,
  ): DirectoryEntry | undefined {
    const lower = name.toLowerCase();
    for (const entry of directory.entries.values())
      if (entry.name.toLowerCase() === lower) return entry;
    return undefined;
  }

  private entryReader(
    source: ByteSource,
    base: number,
    entry: DirectoryEntry,
  ): BitReader {
    if (entry.section !== 0)
      throw new Error(
        `Compression metadata must be in section 0: ${entry.name}`,
      );
    const start = checkedEnd(base, entry.offset, entry.name);
    return new BitReader(
      this.readMetadata(
        source,
        start,
        entry.length,
        CHMParser.MAX_METADATA_STREAM_BYTES,
        entry.name,
      ),
    );
  }

  private readMetadata(
    source: ByteSource,
    offset: number,
    length: number,
    maxBytes: number,
    label: string,
  ): Buffer {
    // Preserve safe-integer/overflow/EOF validation before the allocation limit.
    requireSourceRange(source, offset, length, label);
    if (length > maxBytes)
      throw new RangeError(
        `${label}: metadata budget exceeded (${length} bytes > ${maxBytes} bytes)`,
      );
    return source.read(offset, length);
  }

  /** Omit ResetTable from the result, but never hide corrupt compression metadata. */
  quickParse(reader: BitReader): Omit<ParsedCHM, 'resetTable'> {
    const { header, directory, contentOffset } = this.parse(reader);
    return { header, directory, contentOffset };
  }

  reset(): void {
    this.resetTableProcessor.reset();
  }
}
