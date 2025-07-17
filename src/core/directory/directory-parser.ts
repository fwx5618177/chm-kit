import type { DirectoryEntry, CHMDirectory, ITSPHeader } from '../types';
import type { BitReader } from '../../utils/bit-reader';

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
   * @returns 解析后的目录结构
   */
  static parse(reader: BitReader, itspHeader: ITSPHeader): CHMDirectory {
    const entries = new Map<string, DirectoryEntry>();

    // 解析目录块
    const directoryBlocks = this.parseDirectoryBlocks(reader, itspHeader);

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
   * @returns 目录块数组
   */
  private static parseDirectoryBlocks(
    reader: BitReader,
    itspHeader: ITSPHeader,
  ): Array<{ type: EntryType; data: Buffer }> {
    const blocks: Array<{ type: EntryType; data: Buffer }> = [];
    const chunkSize = itspHeader.chunkSize;
    let currentChunk = 0;

    // 读取所有目录块
    while (currentChunk <= itspHeader.lastPMGI) {
      const blockData = this.readChunk(reader, chunkSize);
      const signature = this.readBlockSignature(blockData);

      if (signature === EntryType.PMGL || signature === EntryType.PMGI) {
        blocks.push({
          type: signature,
          data: blockData,
        });
      }

      currentChunk++;
    }

    return blocks;
  }

  /**
   * 读取一个数据块
   * @param reader 位读取器
   * @param chunkSize 块大小
   * @returns 数据块
   */
  private static readChunk(reader: BitReader, chunkSize: number): Buffer {
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
   * @param blockData 块数据
   * @returns 目录条目数组
   */
  private static parseLeafBlock(blockData: Buffer): DirectoryEntry[] {
    const entries: DirectoryEntry[] = [];

    // 跳过头部（PMGL签名 + 块信息）
    let offset = 20;

    // 读取条目数量
    const entryCount = blockData.readUInt32LE(16);

    for (let i = 0; i < entryCount && offset < blockData.length; i++) {
      try {
        const entry = this.parseDirectoryEntry(blockData, offset);
        entries.push(entry.entry);
        offset = entry.nextOffset;
      } catch (error) {
        // 如果解析失败，跳出循环
        break;
      }
    }

    return entries;
  }

  /**
   * 解析单个目录条目
   * @param data 数据缓冲区
   * @param offset 起始偏移
   * @returns 解析结果
   */
  private static parseDirectoryEntry(
    data: Buffer,
    offset: number,
  ): { entry: DirectoryEntry; nextOffset: number } {
    let currentOffset = offset;

    // 读取名称长度
    const nameLength = data.readUInt8(currentOffset);
    currentOffset += 1;

    // 读取名称
    const nameBuffer = data.subarray(currentOffset, currentOffset + nameLength);
    const name = this.decodeEntryName(nameBuffer);
    currentOffset += nameLength;

    // 读取是否压缩标志
    const isCompressed = data.readUInt8(currentOffset) === 1;
    currentOffset += 1;

    // 读取偏移量
    const offset64 = data.readBigUInt64LE(currentOffset);
    const entryOffset = Number(offset64);
    currentOffset += 8;

    // 读取长度
    const length = data.readUInt32LE(currentOffset);
    currentOffset += 4;

    // 读取未压缩长度（如果压缩）
    let uncompressedLength: number | undefined;
    if (isCompressed) {
      uncompressedLength = data.readUInt32LE(currentOffset);
      currentOffset += 4;
    }

    // 读取节编号
    const section = data.readUInt32LE(currentOffset);
    currentOffset += 4;

    const entry: DirectoryEntry = {
      name,
      isCompressed,
      offset: entryOffset,
      length,
      section,
      ...(uncompressedLength !== undefined && { uncompressedLength }),
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
