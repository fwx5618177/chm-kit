import type { ResetTable, ResetTableEntry } from '../types';
import type { BitReader } from '../../utils/bit-reader';

/**
 * 重置表处理器
 * 负责解析和管理 LZX 解码中的重置表
 */
export class ResetTableProcessor {
  private resetTable: ResetTable | null = null;

  /**
   * 解析重置表
   * @param reader 位读取器
   * @returns 解析后的重置表
   */
  parseResetTable(reader: BitReader): ResetTable {
    // 读取版本号
    const version = reader.read(32);
    if (version !== 2) {
      throw new Error(`不支持的重置表版本: ${version}`);
    }

    // 读取块数量
    const blockCount = reader.read(32);
    if (blockCount <= 0) {
      throw new Error(`无效的块数量: ${blockCount}`);
    }

    // 读取条目大小
    const entrySize = reader.read(32);
    if (entrySize !== 8) {
      throw new Error(`无效的条目大小: ${entrySize}`);
    }

    // 读取表偏移
    const tableOffset = reader.read(32);

    // 读取未压缩长度
    const uncompressedLength = reader.read(32);

    // 读取压缩长度
    const compressedLength = reader.read(32);

    // 读取块大小
    const blockSize = reader.read(32);

    // 解析重置表条目
    const entries = this.parseResetTableEntries(reader, blockCount);

    this.resetTable = {
      version,
      blockCount,
      entrySize,
      tableOffset,
      uncompressedLength,
      compressedLength,
      blockSize,
      entries,
    };

    return this.resetTable;
  }

  /**
   * 解析重置表条目
   * @param reader 位读取器
   * @param blockCount 块数量
   * @returns 重置表条目数组
   */
  private parseResetTableEntries(
    reader: BitReader,
    blockCount: number,
  ): ResetTableEntry[] {
    const entries: ResetTableEntry[] = [];

    for (let i = 0; i < blockCount; i++) {
      const compressedLength = reader.read(32);
      const uncompressedLength = reader.read(32);

      entries.push({
        compressedLength,
        uncompressedLength,
      });
    }

    return entries;
  }

  /**
   * 获取指定块的信息
   * @param blockIndex 块索引
   * @returns 块信息
   */
  getBlockInfo(blockIndex: number): ResetTableEntry | null {
    if (!this.resetTable) {
      return null;
    }

    if (blockIndex < 0 || blockIndex >= this.resetTable.entries.length) {
      return null;
    }

    return this.resetTable.entries[blockIndex]!;
  }

  /**
   * 获取总块数
   * @returns 总块数
   */
  getBlockCount(): number {
    return this.resetTable?.blockCount ?? 0;
  }

  /**
   * 获取块大小
   * @returns 块大小
   */
  getBlockSize(): number {
    return this.resetTable?.blockSize ?? 0;
  }

  /**
   * 计算指定块的偏移量
   * @param blockIndex 块索引
   * @returns 块偏移量
   */
  calculateBlockOffset(blockIndex: number): number {
    if (!this.resetTable) {
      throw new Error('重置表未初始化');
    }

    if (blockIndex < 0 || blockIndex >= this.resetTable.entries.length) {
      throw new Error(`无效的块索引: ${blockIndex}`);
    }

    let offset = this.resetTable.tableOffset;
    for (let i = 0; i < blockIndex; i++) {
      offset += this.resetTable.entries[i]!.compressedLength;
    }

    return offset;
  }

  /**
   * 查找包含指定偏移量的块
   * @param offset 目标偏移量
   * @returns 块索引，如果未找到返回 -1
   */
  findBlockByOffset(offset: number): number {
    if (!this.resetTable) {
      return -1;
    }

    let currentOffset = this.resetTable.tableOffset;

    for (let i = 0; i < this.resetTable.entries.length; i++) {
      const blockEntry = this.resetTable.entries[i]!;
      const nextOffset = currentOffset + blockEntry.compressedLength;

      if (offset >= currentOffset && offset < nextOffset) {
        return i;
      }

      currentOffset = nextOffset;
    }

    return -1;
  }

  /**
   * 验证重置表的完整性
   * @returns 验证结果
   */
  validate(): boolean {
    if (!this.resetTable) {
      return false;
    }

    // 检查基本字段
    if (this.resetTable.version !== 2) {
      return false;
    }

    if (this.resetTable.blockCount <= 0) {
      return false;
    }

    if (this.resetTable.entrySize !== 8) {
      return false;
    }

    // 检查条目数量
    if (this.resetTable.entries.length !== this.resetTable.blockCount) {
      return false;
    }

    // 检查每个条目的有效性
    for (const entry of this.resetTable.entries) {
      if (entry.compressedLength <= 0 || entry.uncompressedLength <= 0) {
        return false;
      }
    }

    return true;
  }

  /**
   * 获取重置表统计信息
   * @returns 统计信息字符串
   */
  getStatistics(): string {
    if (!this.resetTable) {
      return '重置表未初始化';
    }

    const totalCompressed = this.resetTable.entries.reduce(
      (sum, entry) => sum + entry.compressedLength,
      0,
    );

    const totalUncompressed = this.resetTable.entries.reduce(
      (sum, entry) => sum + entry.uncompressedLength,
      0,
    );

    const compressionRatio = (totalCompressed / totalUncompressed) * 100;

    return [
      `重置表版本: ${this.resetTable.version}`,
      `总块数: ${this.resetTable.blockCount}`,
      `块大小: ${this.formatBytes(this.resetTable.blockSize)}`,
      `总压缩大小: ${this.formatBytes(totalCompressed)}`,
      `总未压缩大小: ${this.formatBytes(totalUncompressed)}`,
      `压缩率: ${compressionRatio.toFixed(2)}%`,
    ].join('\n');
  }

  /**
   * 格式化字节数为可读格式
   * @param bytes 字节数
   * @returns 格式化后的字符串
   */
  private formatBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    } else if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(2)} KB`;
    } else {
      return `${bytes} 字节`;
    }
  }

  /**
   * 重置处理器状态
   */
  reset(): void {
    this.resetTable = null;
  }

  /**
   * 获取当前重置表（只读）
   * @returns 重置表的副本
   */
  getResetTable(): ResetTable | null {
    if (!this.resetTable) {
      return null;
    }

    return {
      ...this.resetTable,
      entries: [...this.resetTable.entries],
    };
  }
}
