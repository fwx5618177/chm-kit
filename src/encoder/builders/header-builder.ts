import type {
  ITSFHeader,
  ITSPHeader,
  LZXCHeader,
  DirectoryEntry,
} from '../../core/types';

const HEADER_GUIDS = Buffer.from(
  '10fd017caa7bd0119e0c00a0c922e6ec11fd017caa7bd0119e0c00a0c922e6ec',
  'hex',
);
const DIRECTORY_GUID = Buffer.from('6a92025d2e21d0119df900a0c922e6ec', 'hex');

type ArchiveHeader = ITSFHeader & {
  section0HeaderOffset?: number;
  section0HeaderLength?: number;
  contentOffset?: number;
};
type DirectoryHeader = ITSPHeader & { numChunks?: number; languageId?: number };

/** CHM ENCINT: most significant seven-bit group first, no 32-bit truncation. */
export function encodeEncInt(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid CHM ENCINT: ${value}`);
  }
  const bytes = [value % 128];
  for (
    value = Math.floor(value / 128);
    value > 0;
    value = Math.floor(value / 128)
  ) {
    bytes.unshift(value % 128 | 0x80);
  }
  return Buffer.from(bytes);
}

export class CHMHeaderBuilder {
  static createITSFHeader(options: {
    directoryOffset: number;
    directoryLength: number;
    languageId?: number;
    timestamp?: number;
    section0HeaderOffset?: number;
    section0HeaderLength?: number;
    contentOffset?: number;
  }): ArchiveHeader {
    return {
      signature: 'ITSF',
      version: 3,
      headerLength: 96,
      unknown1: 1,
      timestamp: options.timestamp ?? Math.floor(Date.now() / 1000),
      languageId: options.languageId ?? 0x409,
      unknown2: options.section0HeaderOffset ?? 96,
      unknown3: options.section0HeaderLength ?? 24,
      directoryOffset: options.directoryOffset,
      directoryLength: options.directoryLength,
      unknown4:
        options.contentOffset ??
        options.directoryOffset + options.directoryLength,
      section0HeaderOffset: options.section0HeaderOffset ?? 96,
      section0HeaderLength: options.section0HeaderLength ?? 24,
      contentOffset:
        options.contentOffset ??
        options.directoryOffset + options.directoryLength,
    };
  }

  static createITSPHeader(
    options: {
      chunkSize?: number;
      density?: number;
      depth?: number;
      numChunks?: number;
      languageId?: number;
    } = {},
  ): DirectoryHeader {
    return {
      signature: 'ITSP',
      version: 1,
      headerLength: 84,
      unknown1: 10,
      chunkSize: options.chunkSize ?? 4096,
      density: options.density ?? 2,
      depth: options.depth ?? 1,
      rootIndex: -1,
      firstPMGI: 0,
      lastPMGI: (options.numChunks ?? 1) - 1,
      unknown2: -1,
      numChunks: options.numChunks ?? 1,
      languageId: options.languageId ?? 0x409,
    };
  }

  static createLZXCHeader(
    options: {
      resetInterval?: number;
      windowSize?: number;
      cacheSize?: number;
    } = {},
  ): LZXCHeader {
    return {
      signature: 'LZXC',
      version: 2,
      resetInterval: options.resetInterval ?? 0x8000,
      windowSize: options.windowSize ?? 0x8000,
      cacheSize: options.cacheSize ?? 1,
      unknown: 0,
    };
  }

  static serializeITSFHeader(header: ArchiveHeader): Buffer {
    const buffer = Buffer.alloc(96);
    buffer.write('ITSF', 0, 'ascii');
    buffer.writeUInt32LE(header.version, 4);
    buffer.writeUInt32LE(header.headerLength, 8);
    buffer.writeUInt32LE(header.unknown1, 12);
    buffer.writeUInt32BE(header.timestamp >>> 0, 16);
    buffer.writeUInt32LE(header.languageId, 20);
    HEADER_GUIDS.copy(buffer, 24);
    buffer.writeBigUInt64LE(
      BigInt(header.section0HeaderOffset ?? header.unknown2),
      56,
    );
    buffer.writeBigUInt64LE(
      BigInt(header.section0HeaderLength ?? header.unknown3),
      64,
    );
    buffer.writeBigUInt64LE(BigInt(header.directoryOffset), 72);
    buffer.writeBigUInt64LE(BigInt(header.directoryLength), 80);
    buffer.writeBigUInt64LE(
      BigInt(header.contentOffset ?? header.unknown4),
      88,
    );
    return buffer;
  }

  static serializeITSPHeader(header: DirectoryHeader): Buffer {
    const buffer = Buffer.alloc(84);
    buffer.write('ITSP', 0, 'ascii');
    buffer.writeUInt32LE(header.version, 4);
    buffer.writeUInt32LE(header.headerLength, 8);
    buffer.writeUInt32LE(header.unknown1, 12);
    buffer.writeUInt32LE(header.chunkSize, 16);
    buffer.writeUInt32LE(header.density, 20);
    buffer.writeUInt32LE(header.depth, 24);
    buffer.writeUInt32LE(header.rootIndex >>> 0, 28);
    buffer.writeUInt32LE(header.firstPMGI >>> 0, 32);
    buffer.writeUInt32LE(header.lastPMGI >>> 0, 36);
    buffer.writeUInt32LE(header.unknown2 >>> 0, 40);
    buffer.writeUInt32LE(header.numChunks ?? header.lastPMGI + 1, 44);
    buffer.writeUInt32LE(header.languageId ?? 0x409, 48);
    DIRECTORY_GUID.copy(buffer, 52);
    buffer.writeUInt32LE(84, 68);
    buffer.fill(0xff, 72);
    return buffer;
  }

  /** ControlData contains its DWORD count before LZXC; v2 sizes are in frames. */
  static serializeLZXCHeader(header: LZXCHeader): Buffer {
    if (header.resetInterval % 0x8000 || header.windowSize % 0x8000) {
      throw new Error('LZXC sizes must be multiples of 32 KiB');
    }
    const buffer = Buffer.alloc(28);
    buffer.writeUInt32LE(6, 0);
    buffer.write('LZXC', 4, 'ascii');
    buffer.writeUInt32LE(header.version, 8);
    const unit = header.version === 2 ? 0x8000 : 1;
    buffer.writeUInt32LE(header.resetInterval / unit, 12);
    buffer.writeUInt32LE(header.windowSize / unit, 16);
    buffer.writeUInt32LE(header.cacheSize, 20);
    buffer.writeUInt32LE(header.unknown, 24);
    return buffer;
  }

  /** PMGL leaf chain. A missing PMGI root (-1) permits standard linear lookup. */
  static serializeDirectory(
    entries: DirectoryEntry[],
    chunkSize = 4096,
    density = 2,
  ): Buffer {
    if (chunkSize < 32 || chunkSize > 0x10000 || !Number.isInteger(chunkSize)) {
      throw new Error('Invalid CHM directory chunk size');
    }
    if (!Number.isInteger(density) || density < 0 || density > 10) {
      throw new Error('Invalid CHM quickref density');
    }
    const stride = 2 ** density + 1;
    const sorted = [...entries].sort((a, b) => {
      const lower = Buffer.compare(
        Buffer.from(a.name.toLowerCase()),
        Buffer.from(b.name.toLowerCase()),
      );
      return lower || Buffer.compare(Buffer.from(a.name), Buffer.from(b.name));
    });
    const groups: Buffer[][] = [];
    let group: Buffer[] = [];
    let used = 20;
    for (const entry of sorted) {
      const name = Buffer.from(entry.name, 'utf8');
      const encoded = Buffer.concat([
        encodeEncInt(name.length),
        name,
        encodeEncInt(entry.section),
        encodeEncInt(entry.offset),
        encodeEncInt(entry.length),
      ]);
      if (encoded.length + 22 > chunkSize) {
        throw new Error(
          `CHM directory entry exceeds chunk size: ${entry.name}`,
        );
      }
      const quickrefSize = 2 * Math.ceil((group.length + 1) / stride);
      if (used + encoded.length + quickrefSize > chunkSize && group.length) {
        groups.push(group);
        group = [];
        used = 20;
      }
      group.push(encoded);
      used += encoded.length;
    }
    if (group.length || !groups.length) groups.push(group);
    return Buffer.concat(
      groups.map((items, index) => {
        const chunk = Buffer.alloc(chunkSize);
        chunk.write('PMGL', 0, 'ascii');
        chunk.writeInt32LE(index === 0 ? -1 : index - 1, 12);
        chunk.writeInt32LE(index === groups.length - 1 ? -1 : index + 1, 16);
        let position = 20;
        items.forEach((item, entryIndex) => {
          // Group zero implicitly starts at entry offset 0. Remaining quickrefs
          // are stored backwards before the trailing 16-bit entry count.
          if (entryIndex > 0 && entryIndex % stride === 0) {
            chunk.writeUInt16LE(
              position - 20,
              chunkSize - 2 - 2 * (entryIndex / stride),
            );
          }
          item.copy(chunk, position);
          position += item.length;
        });
        chunk.writeUInt32LE(chunkSize - position, 4);
        chunk.writeUInt16LE(items.length, chunkSize - 2);
        return chunk;
      }),
    );
  }

  /** @deprecated Components are addressable streams, not a contiguous header. */
  static calculateHeaderSize(resetTableSize: number): number {
    return 96 + 24 + 84 + 28 + resetTableSize;
  }

  static validateHeader(header: ITSFHeader | ITSPHeader | LZXCHeader): boolean {
    if (header.signature === 'ITSF' && 'directoryOffset' in header) {
      return (
        header.version === 3 &&
        header.headerLength === 96 &&
        Number.isSafeInteger(header.directoryOffset) &&
        header.directoryOffset >= 120 &&
        Number.isSafeInteger(header.directoryLength) &&
        header.directoryLength >= 84
      );
    }
    if (header.signature === 'ITSP' && 'chunkSize' in header) {
      return (
        header.version === 1 &&
        header.headerLength === 84 &&
        header.chunkSize >= 32 &&
        header.density >= 0 &&
        header.depth >= 1
      );
    }
    if (header.signature === 'LZXC' && 'windowSize' in header) {
      return (
        (header.version === 1 || header.version === 2) &&
        header.resetInterval > 0 &&
        header.resetInterval % 0x8000 === 0 &&
        header.windowSize >= 0x8000 &&
        header.windowSize <= 0x200000 &&
        (header.windowSize & (header.windowSize - 1)) === 0
      );
    }
    return false;
  }
}
