import type {
  ITSFHeader,
  ITSPHeader,
  LZXCHeader,
  DirectoryEntry,
} from '../../core/types';

/**
 * CHM 头部构建器
 * 负责创建和序列化 CHM 文件头部
 */
export class CHMHeaderBuilder {
  /**
   * 创建 ITSF 头部
   * @param options 头部选项
   * @returns ITSF 头部
   */
  static createITSFHeader(options: {
    directoryOffset: number;
    directoryLength: number;
    languageId?: number;
    timestamp?: number;
  }): ITSFHeader {
    return {
      signature: 'ITSF',
      version: 3,
      headerLength: 96,
      unknown1: 0,
      timestamp: options.timestamp || Math.floor(Date.now() / 1000),
      languageId: options.languageId || 0x409, // 默认英语
      unknown2: 0,
      unknown3: 0,
      directoryOffset: options.directoryOffset,
      directoryLength: options.directoryLength,
      unknown4: 0,
    };
  }

  /**
   * 创建 ITSP 头部
   * @param options 头部选项
   * @returns ITSP 头部
   */
  static createITSPHeader(
    options: {
      chunkSize?: number;
      density?: number;
      depth?: number;
    } = {},
  ): ITSPHeader {
    return {
      signature: 'ITSP',
      version: 1,
      headerLength: 84,
      unknown1: 0,
      chunkSize: options.chunkSize || 4096,
      density: options.density || 2,
      depth: options.depth || 2,
      rootIndex: 0,
      firstPMGI: 0,
      lastPMGI: 0,
      unknown2: 0,
    };
  }

  /**
   * 创建 LZXC 头部
   * @param options 头部选项
   * @returns LZXC 头部
   */
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
      resetInterval: options.resetInterval || 0x8000,
      windowSize: options.windowSize || 0x8000,
      cacheSize: options.cacheSize || 0,
      unknown: 0,
    };
  }

  /**
   * 序列化 ITSF 头部
   * @param header ITSF 头部
   * @returns 序列化后的数据
   */
  static serializeITSFHeader(header: ITSFHeader): Buffer {
    const buffer = Buffer.alloc(96);
    let offset = 0;

    // 写入签名
    buffer.write(header.signature, offset, 4, 'ascii');
    offset += 4;

    // 写入其他字段
    buffer.writeUInt32LE(header.version, offset);
    offset += 4;
    buffer.writeUInt32LE(header.headerLength, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown1, offset);
    offset += 4;
    buffer.writeUInt32LE(header.timestamp, offset);
    offset += 4;
    buffer.writeUInt32LE(header.languageId, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown2, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown3, offset);
    offset += 4;
    buffer.writeUInt32LE(header.directoryOffset, offset);
    offset += 4;
    buffer.writeUInt32LE(header.directoryLength, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown4, offset);

    return buffer;
  }

  /**
   * 序列化 ITSP 头部
   * @param header ITSP 头部
   * @returns 序列化后的数据
   */
  static serializeITSPHeader(header: ITSPHeader): Buffer {
    const buffer = Buffer.alloc(84);
    let offset = 0;

    buffer.write(header.signature, offset, 4, 'ascii');
    offset += 4;
    buffer.writeUInt32LE(header.version, offset);
    offset += 4;
    buffer.writeUInt32LE(header.headerLength, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown1, offset);
    offset += 4;
    buffer.writeUInt32LE(header.chunkSize, offset);
    offset += 4;
    buffer.writeUInt32LE(header.density, offset);
    offset += 4;
    buffer.writeUInt32LE(header.depth, offset);
    offset += 4;
    buffer.writeUInt32LE(header.rootIndex, offset);
    offset += 4;
    buffer.writeUInt32LE(header.firstPMGI, offset);
    offset += 4;
    buffer.writeUInt32LE(header.lastPMGI, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown2, offset);

    return buffer;
  }

  /**
   * 序列化 LZXC 头部
   * @param header LZXC 头部
   * @returns 序列化后的数据
   */
  static serializeLZXCHeader(header: LZXCHeader): Buffer {
    const buffer = Buffer.alloc(40);
    let offset = 0;

    buffer.write(header.signature, offset, 4, 'ascii');
    offset += 4;
    buffer.writeUInt32LE(header.version, offset);
    offset += 4;
    buffer.writeUInt32LE(header.resetInterval, offset);
    offset += 4;
    buffer.writeUInt32LE(header.windowSize, offset);
    offset += 4;
    buffer.writeUInt32LE(header.cacheSize, offset);
    offset += 4;
    buffer.writeUInt32LE(header.unknown, offset);

    return buffer;
  }

  /**
   * 序列化目录条目
   * @param entries 目录条目数组
   * @returns 序列化后的目录数据
   */
  static serializeDirectory(entries: DirectoryEntry[]): Buffer {
    const entrySize = 32;
    const buffer = Buffer.alloc(entries.length * entrySize);
    let offset = 0;

    for (const entry of entries) {
      // 写入文件名长度
      const nameBuffer = Buffer.from(entry.name, 'utf-8');
      buffer.writeUInt16LE(nameBuffer.length, offset);
      offset += 2;

      // 写入文件名
      nameBuffer.copy(buffer, offset);
      offset += Math.min(nameBuffer.length, 24); // 最大 24 字节文件名

      // 填充剩余字节
      while (offset % entrySize !== 26) {
        buffer.writeUInt8(0, offset);
        offset++;
      }

      // 写入其他属性
      buffer.writeUInt8(entry.isCompressed ? 1 : 0, offset);
      offset += 1;
      buffer.writeUInt8(entry.section, offset);
      offset += 1;
      buffer.writeUInt32LE(entry.offset, offset);
      offset += 4;

      // 确保偏移对齐到条目边界
      offset = Math.ceil(offset / entrySize) * entrySize;
    }

    return buffer;
  }

  /**
   * 计算头部总大小
   * @param resetTableSize 重置表大小
   * @returns 头部总大小
   */
  static calculateHeaderSize(resetTableSize: number): number {
    return 96 + 84 + 40 + resetTableSize; // ITSF + ITSP + LZXC + resetTable
  }

  /**
   * 验证头部数据
   * @param header 头部数据
   * @returns 验证结果
   */
  static validateHeader(header: ITSFHeader | ITSPHeader | LZXCHeader): boolean {
    if ('signature' in header) {
      const validSignatures = ['ITSF', 'ITSP', 'LZXC'];
      return validSignatures.includes(header.signature);
    }
    return false;
  }
}
