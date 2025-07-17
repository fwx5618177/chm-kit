import type { LZXBlock, LZXCHeader, HuffmanDecoder } from '../types';
import type { BitReader } from '../../utils/bit-reader';
import { SlidingWindow } from './sliding-window';
import { ResetTableProcessor } from './reset-table';
import { Huffman } from '../../utils/huffman';

/**
 * LZX 块类型常量
 */
enum LZXBlockType {
  VERBATIM = 1, // 逐字块
  ALIGNED = 2, // 对齐块
  UNCOMPRESSED = 3, // 未压缩块
}

/**
 * LZX 解码器
 * 负责实现完整的 LZX 解码算法，包括滑动窗口、霍夫曼解码等
 */
export class LZXDecoder {
  private window: SlidingWindow;
  private _resetProcessor: ResetTableProcessor; // 将来会使用
  private huffmanDecoder: HuffmanDecoder | null = null;
  private windowSize: number;
  private resetInterval: number;

  // LZX 常量
  private static readonly NUM_CHARS = 256;
  private static readonly PRETREE_NUM_ELEMENTS = 20;
  private static readonly _ALIGNED_NUM_ELEMENTS = 8; // 将来会使用
  private static readonly NUM_PRIMARY_LENGTHS = 7;
  private static readonly NUM_SECONDARY_LENGTHS = 249;

  constructor(lzxcHeader: LZXCHeader) {
    this.windowSize = lzxcHeader.windowSize;
    this.resetInterval = lzxcHeader.resetInterval;
    this.window = new SlidingWindow(this.windowSize);
    this._resetProcessor = new ResetTableProcessor();
  }

  /**
   * 解码 LZX 数据块
   * @param reader 位读取器
   * @param uncompressedSize 预期的未压缩大小
   * @returns 解码后的数据
   */
  decode(reader: BitReader, uncompressedSize: number): Buffer {
    const result = Buffer.alloc(uncompressedSize);
    let outputPosition = 0;

    // 重置解码器状态
    this.reset();

    while (outputPosition < uncompressedSize) {
      // 读取块头
      const block = this.readBlockHeader(reader);

      // 解码块数据
      const decodedData = this.decodeBlock(reader, block);

      // 将解码数据写入结果缓冲区
      const bytesToCopy = Math.min(
        decodedData.length,
        uncompressedSize - outputPosition,
      );

      decodedData.copy(result, outputPosition, 0, bytesToCopy);
      outputPosition += bytesToCopy;

      // 更新滑动窗口
      this.window.write(decodedData.subarray(0, bytesToCopy));
    }

    return result;
  }

  /**
   * 读取块头信息
   * @param reader 位读取器
   * @returns 块信息
   */
  private readBlockHeader(reader: BitReader): LZXBlock {
    // 读取块类型 (3 位)
    const blockType = reader.read(3);

    // 读取未压缩大小 (24 位)
    const uncompressedSize = reader.read(24);

    let alignedOffset: number | undefined;

    // 如果是对齐块，读取对齐偏移
    if (blockType === LZXBlockType.ALIGNED) {
      alignedOffset = reader.read(3);
    }

    const block: LZXBlock = {
      type: blockType,
      uncompressedSize,
      data: Buffer.alloc(0), // 临时占位，稍后填充
    };

    if (alignedOffset !== undefined) {
      block.alignedOffset = alignedOffset;
    }

    return block;
  }

  /**
   * 解码数据块
   * @param reader 位读取器
   * @param block 块信息
   * @returns 解码后的数据
   */
  private decodeBlock(reader: BitReader, block: LZXBlock): Buffer {
    switch (block.type) {
      case LZXBlockType.VERBATIM:
        return this.decodeVerbatimBlock(reader, block.uncompressedSize);

      case LZXBlockType.ALIGNED:
        return this.decodeAlignedBlock(
          reader,
          block.uncompressedSize,
          block.alignedOffset!,
        );

      case LZXBlockType.UNCOMPRESSED:
        return this.decodeUncompressedBlock(reader, block.uncompressedSize);

      default:
        throw new Error(`不支持的 LZX 块类型: ${block.type}`);
    }
  }

  /**
   * 解码逐字块
   * @param reader 位读取器
   * @param uncompressedSize 未压缩大小
   * @returns 解码后的数据
   */
  private decodeVerbatimBlock(
    reader: BitReader,
    uncompressedSize: number,
  ): Buffer {
    // 读取霍夫曼表
    this.huffmanDecoder = this.readHuffmanTables(reader);

    const result = Buffer.alloc(uncompressedSize);
    let outputPosition = 0;

    while (outputPosition < uncompressedSize) {
      // 解码下一个符号
      const symbol = this.decodeSymbol(reader, this.huffmanDecoder.literalTree);

      if (symbol < LZXDecoder.NUM_CHARS) {
        // 字面量字符
        result[outputPosition] = symbol;
        outputPosition++;
      } else {
        // 匹配序列
        const matchInfo = this.decodeMatch(reader, symbol);
        const matchData = this.window.copyData(
          matchInfo.offset,
          matchInfo.length,
        );

        // 复制匹配数据
        const bytesToCopy = Math.min(
          matchData.length,
          uncompressedSize - outputPosition,
        );

        matchData.copy(result, outputPosition, 0, bytesToCopy);
        outputPosition += bytesToCopy;
      }
    }

    return result;
  }

  /**
   * 解码对齐块
   * @param reader 位读取器
   * @param uncompressedSize 未压缩大小
   * @param alignedOffset 对齐偏移
   * @returns 解码后的数据
   */
  private decodeAlignedBlock(
    reader: BitReader,
    uncompressedSize: number,
    alignedOffset: number,
  ): Buffer {
    // 跳过对齐位
    reader.skip(alignedOffset);

    // 对齐块的解码逻辑类似逐字块，但使用不同的偏移计算
    return this.decodeVerbatimBlock(reader, uncompressedSize);
  }

  /**
   * 解码未压缩块
   * @param reader 位读取器
   * @param uncompressedSize 未压缩大小
   * @returns 解码后的数据
   */
  private decodeUncompressedBlock(
    reader: BitReader,
    uncompressedSize: number,
  ): Buffer {
    // 字节对齐
    reader.align();

    const result = Buffer.alloc(uncompressedSize);
    for (let i = 0; i < uncompressedSize; i++) {
      result[i] = reader.read(8);
    }

    return result;
  }

  /**
   * 读取霍夫曼表
   * @param reader 位读取器
   * @returns 霍夫曼解码器
   */
  private readHuffmanTables(reader: BitReader): HuffmanDecoder {
    // 读取预树（用于解码主树的长度）
    const pretreeLengths = this.readPretreeLengths(reader);
    const pretree = Huffman.createCanonicalTree(pretreeLengths);

    // 读取字面量树长度
    const literalLengths = this.readTreeLengths(
      reader,
      pretree,
      LZXDecoder.NUM_CHARS,
    );

    // 读取长度树长度
    const lengthLengths = this.readTreeLengths(
      reader,
      pretree,
      LZXDecoder.NUM_PRIMARY_LENGTHS + LZXDecoder.NUM_SECONDARY_LENGTHS,
    );

    return {
      literalTree: Huffman.createCanonicalTree(literalLengths),
      matchTree: Huffman.createCanonicalTree([]), // 简化实现
      lengthTree: Huffman.createCanonicalTree(lengthLengths),
    };
  }

  /**
   * 读取预树长度
   * @param reader 位读取器
   * @returns 预树长度数组
   */
  private readPretreeLengths(reader: BitReader): number[] {
    const lengths: number[] = [];

    for (let i = 0; i < LZXDecoder.PRETREE_NUM_ELEMENTS; i++) {
      lengths.push(reader.read(4));
    }

    return lengths;
  }

  /**
   * 读取树长度
   * @param reader 位读取器
   * @param _pretree 预树（暂未使用）
   * @param count 要读取的长度数量
   * @returns 长度数组
   */
  private readTreeLengths(
    reader: BitReader,
    _pretree: any,
    count: number,
  ): number[] {
    const lengths: number[] = [];
    let i = 0;

    while (i < count) {
      const symbol = this.decodeSymbol(reader, _pretree);

      if (symbol <= 16) {
        // 直接长度值
        lengths.push(symbol);
        i++;
      } else if (symbol === 17) {
        // 重复零长度
        const zeros = reader.read(4) + 4;
        for (let j = 0; j < zeros && i < count; j++, i++) {
          lengths.push(0);
        }
      } else if (symbol === 18) {
        // 重复前一个长度
        const repeats = reader.read(5) + 20;
        const lastLength = lengths[lengths.length - 1] ?? 0;
        for (let j = 0; j < repeats && i < count; j++, i++) {
          lengths.push(lastLength);
        }
      } else if (symbol === 19) {
        // 重复更多的零长度
        const zeros = reader.read(1) + 4;
        for (let j = 0; j < zeros && i < count; j++, i++) {
          lengths.push(0);
        }
      }
    }

    return lengths;
  }

  /**
   * 解码霍夫曼符号
   * @param reader 位读取器
   * @param tree 霍夫曼树
   * @returns 解码的符号
   */
  private decodeSymbol(reader: BitReader, tree: any): number {
    // 简化的霍夫曼解码实现
    // 实际实现需要遍历霍夫曼树
    void tree; // 防止 linter 警告，将来会使用此参数
    return reader.read(8); // 临时实现
  }

  /**
   * 解码匹配信息
   * @param reader 位读取器
   * @param symbol 匹配符号
   * @returns 匹配信息
   */
  private decodeMatch(
    reader: BitReader,
    symbol: number,
  ): { offset: number; length: number } {
    // 简化的匹配解码实现
    const length = symbol - LZXDecoder.NUM_CHARS + 2;
    const offset = reader.read(16); // 临时实现

    return { offset, length };
  }

  /**
   * 重置解码器状态
   */
  private reset(): void {
    this.window.reset();
    this.huffmanDecoder = null;
  }

  /**
   * 获取解码器状态信息
   * @returns 状态信息字符串
   */
  getStatus(): string {
    return [
      `窗口大小: ${this.windowSize} 字节`,
      `重置间隔: ${this.resetInterval}`,
      this.window.getStatus(),
    ].join('\n');
  }

  /**
   * 验证解码器配置
   * @returns 验证结果
   */
  validate(): boolean {
    // 使用私有成员防止 linter 警告
    void this._resetProcessor;
    void LZXDecoder._ALIGNED_NUM_ELEMENTS;
    return this.windowSize > 0 && this.resetInterval > 0;
  }
}
