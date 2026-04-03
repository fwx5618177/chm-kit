import type { DirectoryEntry, CHMDirectory, ITSPHeader } from '../types';
import type { BitReader as IBitReader } from '../../utils/io/bit-reader';

/**
 * 目录条目类型
 */
enum EntryType {
  PMGL = 'PMGL', // 叶子目录块
  PMGI = 'PMGI', // 索引目录块
}

/**
 * 目录解析器
 * 负责解析 CHM 文件的目录块并构建路径索引树
 */
export class DirectoryParser {
  /**
   * 解析目录结构
   * @param reader 位读取器
   * @param itspHeader ITSP 头部信息
   * @param numChunks 目录块总数（由 ITSF directoryLength 计算）
   * @returns 解析后的目录结构
   */
  static parse(
    reader: IBitReader,
    itspHeader: ITSPHeader,
    numChunks: number,
  ): CHMDirectory {
    const entries = new Map<string, DirectoryEntry>();

    // 解析目录块
    const directoryBlocks = this.parseDirectoryBlocks(
      reader,
      itspHeader,
      numChunks,
    );

    // 从叶子节点中提取文件信息
    for (const block of directoryBlocks) {
      if (block.type === EntryType.PMGL) {
        const blockEntries = this.parseLeafBlock(block.data);
        for (const entry of blockEntries) {
          entries.set(entry.name, entry);
        }
      }
    }

    return {
      entries,
      rootPath: '/',
    };
  }

  /**
   * 解析目录块
   * @param reader 位读取器
   * @param itspHeader ITSP 头部信息
   * @param numChunks 应读取的块总数
   * @returns 目录块数组
   */
  private static parseDirectoryBlocks(
    reader: IBitReader,
    itspHeader: ITSPHeader,
    numChunks: number,
  ): Array<{ type: EntryType; data: Buffer }> {
    const blocks: Array<{ type: EntryType; data: Buffer }> = [];
    const chunkSize = itspHeader.chunkSize;

    // 读取所有目录块，numChunks 由调用方根据 directoryLength / chunkSize 计算
    for (let i = 0; i < numChunks; i++) {
      try {
        const blockData = this.readChunk(reader, chunkSize);
        const signature = this.readBlockSignature(blockData);

        if (signature === EntryType.PMGL || signature === EntryType.PMGI) {
          blocks.push({ type: signature, data: blockData });
        }
      } catch {
        // 如果读取失败（EOF 等），提前结束
        break;
      }
    }

    return blocks;
  }

  /**
   * 读取一个数据块
   * @param reader 位读取器
   * @param chunkSize 块大小
   * @returns 数据块
   */
  private static readChunk(reader: IBitReader, chunkSize: number): Buffer {
    const chunk = Buffer.alloc(chunkSize);
    for (let i = 0; i < chunkSize; i++) {
      chunk[i] = reader.read(8);
    }
    return chunk;
  }

  /**
   * 读取块签名
   * @param blockData 块数据
   * @returns 块签名
   */
  private static readBlockSignature(blockData: Buffer): EntryType {
    const signature = blockData.subarray(0, 4).toString('ascii');
    if (signature === 'PMGL') return EntryType.PMGL;
    if (signature === 'PMGI') return EntryType.PMGI;
    throw new Error(`未知的块签名: ${signature}`);
  }

  /**
   * 解析叶子块（PMGL）
   * PMGL 头部结构: 签名(4) + 空闲空间(4) + 未知(4) + 前一块(4) + 后一块(4) = 20字节
   * 条目紧随头部之后，直到到达空闲空间区域
   * @param blockData 块数据
   * @returns 目录条目数组
   */
  private static parseLeafBlock(blockData: Buffer): DirectoryEntry[] {
    const entries: DirectoryEntry[] = [];

    // PMGL 头部: 4(sig) + 4(freeSpace) + 4(unknown) + 4(prev) + 4(next) = 20
    let offset = 20;

    // 空闲空间长度 - 条目数据到此结束
    const freeSpace = blockData.readUInt32LE(4);
    const dataEnd = blockData.length - freeSpace;

    while (offset < dataEnd) {
      try {
        const entry = this.parseDirectoryEntry(blockData, offset);
        entries.push(entry.entry);
        offset = entry.nextOffset;
      } catch {
        // 如果解析失败，跳出循环
        break;
      }
    }

    return entries;
  }

  /**
   * 读取 CHM 编码整数（ENCINT）
   * CHM 使用变长编码: 每字节7位数据 + 1位继续标志（高位）
   * @param data 数据缓冲区
   * @param offset 起始偏移
   * @returns 解码值和下一个偏移
   */
  private static readEncInt(
    data: Buffer,
    offset: number,
  ): { value: number; nextOffset: number } {
    let value = 0;
    let currentOffset = offset;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (currentOffset >= data.length) {
        throw new Error('读取编码整数时超出缓冲区边界');
      }
      const byte = data.readUInt8(currentOffset);
      currentOffset++;
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) {
        break;
      }
    }

    return { value, nextOffset: currentOffset };
  }

  /**
   * 解析单个目录条目
   * CHM 目录条目格式: 名称长度(ENCINT) + 名称(UTF-8) + 节号(ENCINT) + 偏移(ENCINT) + 长度(ENCINT)
   * @param data 数据缓冲区
   * @param offset 起始偏移
   * @returns 解析结果
   */
  private static parseDirectoryEntry(
    data: Buffer,
    offset: number,
  ): { entry: DirectoryEntry; nextOffset: number } {
    let currentOffset = offset;

    // 读取名称长度 (ENCINT)
    const nameLenResult = this.readEncInt(data, currentOffset);
    const nameLength = nameLenResult.value;
    currentOffset = nameLenResult.nextOffset;

    // 读取名称 (UTF-8)
    const nameBuffer = data.subarray(currentOffset, currentOffset + nameLength);
    const name = this.decodeEntryName(nameBuffer);
    currentOffset += nameLength;

    // 读取节编号 (ENCINT)
    const sectionResult = this.readEncInt(data, currentOffset);
    const section = sectionResult.value;
    currentOffset = sectionResult.nextOffset;

    // 读取偏移量 (ENCINT)
    const offsetResult = this.readEncInt(data, currentOffset);
    const entryOffset = offsetResult.value;
    currentOffset = offsetResult.nextOffset;

    // 读取长度 (ENCINT)
    const lengthResult = this.readEncInt(data, currentOffset);
    const length = lengthResult.value;
    currentOffset = lengthResult.nextOffset;

    // 节1中的文件是压缩的
    const isCompressed = section === 1;

    const entry: DirectoryEntry = {
      name,
      isCompressed,
      offset: entryOffset,
      length,
      // section 1 中 offset/length 均在未压缩流空间，length 即为未压缩大小
      ...(isCompressed ? { uncompressedLength: length } : {}),
      section,
    };

    return {
      entry,
      nextOffset: currentOffset,
    };
  }

  /**
   * 解码条目名称
   * @param nameBuffer 名称缓冲区
   * @returns 解码后的名称
   */
  private static decodeEntryName(nameBuffer: Buffer): string {
    // CHM 文件中的名称通常使用 UTF-8 编码
    return nameBuffer.toString('utf8');
  }

  /**
   * 验证目录结构的完整性
   * @param directory 目录结构
   * @returns 验证结果
   */
  static validate(directory: CHMDirectory): boolean {
    if (!directory.entries || directory.entries.size === 0) {
      return false;
    }

    // 检查是否有必要的文件
    const hasValidEntries = Array.from(directory.entries.values()).some(
      entry => entry.name && entry.offset >= 0 && entry.length >= 0,
    );

    return hasValidEntries;
  }

  /**
   * 获取目录信息摘要
   * @param directory 目录结构
   * @returns 目录信息字符串
   */
  static getSummary(directory: CHMDirectory): string {
    const totalFiles = directory.entries.size;
    const compressedFiles = Array.from(directory.entries.values()).filter(
      entry => entry.isCompressed,
    ).length;
    const totalSize = Array.from(directory.entries.values()).reduce(
      (sum, entry) => sum + entry.length,
      0,
    );

    return [
      `总文件数: ${totalFiles}`,
      `压缩文件数: ${compressedFiles}`,
      `未压缩文件数: ${totalFiles - compressedFiles}`,
      `总大小: ${this.formatBytes(totalSize)}`,
    ].join('\n');
  }

  /**
   * 格式化字节数为可读格式
   * @param bytes 字节数
   * @returns 格式化后的字符串
   */
  private static formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    } else if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    } else {
      return `${bytes} 字节`;
    }
  }
}
