import type { LZXConfig } from '../core/types';

/**
 * LZX 编码器
 * 实现 Microsoft LZX 压缩算法
 */
export class LZXEncoder {
  private windowSize: number;
  private resetInterval: number;
  private compressionLevel: number;

  constructor(config: LZXConfig = {}) {
    this.windowSize = config.windowSize || 0x8000; // 32KB 默认窗口大小
    this.resetInterval = config.resetInterval || 0x8000; // 重置间隔
    this.compressionLevel = config.compressionLevel || 6;
  }

  /**
   * 压缩数据
   * @param inputBuffer 输入数据
   * @returns 压缩后的数据和重置表
   */
  compress(inputBuffer: Buffer): {
    compressedData: Buffer;
    resetTable: Buffer;
    uncompressedSize: number;
    compressedSize: number;
  } {
    const input = new Uint8Array(inputBuffer);
    const output: number[] = [];
    const resetTable: Array<{
      compressedLength: number;
      uncompressedLength: number;
    }> = [];

    let position = 0;

    while (position < input.length) {
      const blockSize = Math.min(this.resetInterval, input.length - position);
      const blockData = input.slice(position, position + blockSize);

      // 压缩当前块
      const compressedBlock = this.compressBlock(blockData);

      // 记录重置表条目
      resetTable.push({
        uncompressedLength: blockSize,
        compressedLength: compressedBlock.length,
      });

      // 添加到输出
      output.push(...compressedBlock);
      position += blockSize;
    }

    // 生成重置表
    const resetTableBuffer = this.generateResetTable(resetTable);

    return {
      compressedData: Buffer.from(output),
      resetTable: resetTableBuffer,
      uncompressedSize: input.length,
      compressedSize: output.length,
    };
  }

  /**
   * 压缩单个块
   * @param block 要压缩的块数据
   * @returns 压缩后的块数据
   */
  private compressBlock(block: Uint8Array): number[] {
    // 简化的 LZX 压缩实现
    // 在实际应用中，这里需要实现完整的 LZX 算法
    const output: number[] = [];

    // LZX 块头 - 简化版本
    output.push(0x03); // 块类型：压缩块

    // 添加未压缩大小（24位）
    const uncompressedSize = block.length;
    output.push(uncompressedSize & 0xff);
    output.push((uncompressedSize >> 8) & 0xff);
    output.push((uncompressedSize >> 16) & 0xff);

    // 简化压缩：查找重复序列
    let i = 0;
    while (i < block.length) {
      const bestMatch = this.findBestMatch(block, i);

      if (bestMatch.length >= 3) {
        // 输出匹配
        this.outputMatch(output, bestMatch.distance, bestMatch.length);
        i += bestMatch.length;
      } else {
        // 输出字面量
        this.outputLiteral(output, block[i] || 0);
        i++;
      }
    }

    return output;
  }

  /**
   * 查找最佳匹配
   * @param data 数据
   * @param position 当前位置
   * @returns 最佳匹配信息
   */
  private findBestMatch(
    data: Uint8Array,
    position: number,
  ): { distance: number; length: number } {
    let bestDistance = 0;
    let bestLength = 0;

    const searchStart = Math.max(0, position - this.windowSize);
    const maxLength = Math.min(258, data.length - position);

    for (let i = searchStart; i < position; i++) {
      let length = 0;
      while (
        length < maxLength &&
        i + length < position &&
        data[i + length] === data[position + length]
      ) {
        length++;
      }

      if (length > bestLength) {
        bestLength = length;
        bestDistance = position - i;
      }
    }

    return { distance: bestDistance, length: bestLength };
  }

  /**
   * 输出匹配数据
   * @param output 输出数组
   * @param distance 距离
   * @param length 长度
   */
  private outputMatch(
    output: number[],
    distance: number,
    length: number,
  ): void {
    // 简化的匹配编码
    // 位 0: 1 (表示这是匹配)
    // 位 1-8: 长度 - 3
    // 位 9-24: 距离
    const code = 0x80 | ((length - 3) & 0x7f);
    output.push(code);
    output.push(distance & 0xff);
    output.push((distance >> 8) & 0xff);
  }

  /**
   * 输出字面量数据
   * @param output 输出数组
   * @param literal 字面量字节
   */
  private outputLiteral(output: number[], literal: number): void {
    // 简化的字面量编码
    // 位 0: 0 (表示这是字面量)
    // 位 1-8: 字面量值
    output.push(literal & 0x7f);
  }

  /**
   * 生成重置表
   * @param entries 重置表条目
   * @returns 重置表缓冲区
   */
  private generateResetTable(
    entries: Array<{ compressedLength: number; uncompressedLength: number }>,
  ): Buffer {
    const buffer = Buffer.alloc(16 + entries.length * 8);
    let offset = 0;

    // 重置表头部
    buffer.writeUInt32LE(2, offset); // 版本
    offset += 4;
    buffer.writeUInt32LE(entries.length, offset); // 块数量
    offset += 4;
    buffer.writeUInt32LE(8, offset); // 条目大小
    offset += 4;
    buffer.writeUInt32LE(16, offset); // 表偏移量
    offset += 4;

    // 重置表条目
    for (const entry of entries) {
      buffer.writeUInt32LE(entry.compressedLength, offset);
      offset += 4;
      buffer.writeUInt32LE(entry.uncompressedLength, offset);
      offset += 4;
    }

    return buffer;
  }

  /**
   * 获取编码器配置
   */
  getConfig(): LZXConfig {
    return {
      windowSize: this.windowSize,
      resetInterval: this.resetInterval,
      compressionLevel: this.compressionLevel,
    };
  }
}
